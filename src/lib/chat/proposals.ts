import { z } from "zod";
import { prisma, j } from "@/lib/db";
import type { OwnedItinerary } from "@/lib/auth/ownership";
import { skipMeal, unskipMeal } from "@/lib/skippedMeals";
import { PICKER_REQUEST_MAX_LENGTH } from "@/lib/inputLimits";
import { proposalProblem } from "@/lib/chat/proposalRules";
import { planRestructure } from "@/lib/chat/restructureProposal";
import type { ChatProposalDraft } from "@/lib/chat/assistant";
import type { MealType } from "@/types/itinerary";

// Confirming or cancelling a chat proposal (PLAN-004, ADR-0013).
//
// One-step changes (remove or move a stop, remove or restore a meal) are
// applied here on confirm. Changes that need a pick (another stop, more
// stops, another restaurant, another hotel) open the existing picker
// instead, and a restructure returns the request for restructure/route.ts
// with a preview; either counts as applied once the screen reports it done
// ("picked"), and the picker's or restructure's own route charges its quota.
//
// A proposal leaves "pending" only through a conditional update, so two
// confirms of the same card apply the change once.

export const ProposalDecisionSchema = z.object({ decision: z.enum(["confirm", "cancel", "picked"]) });
export type ProposalDecision = z.infer<typeof ProposalDecisionSchema>["decision"];

type Rec = Record<string, unknown>;
type Days = Rec[];

/** What the screen opens for a change that needs a pick. */
export type PickerRequest =
  | { picker: "stop"; dayId: string; stopId: string }
  | { picker: "suggestions"; dayId: string; request: string | null }
  | { picker: "meal"; dayId: string; mealType: MealType; request: string | null }
  | { picker: "accommodation"; dayId: string };

const shortRequest = (request: string | null) => (request ? request.trim().slice(0, PICKER_REQUEST_MAX_LENGTH) || null : null);

function pickerFor(proposal: ChatProposalDraft): PickerRequest | null {
  switch (proposal.action) {
    case "replace_stop":
      return { picker: "stop", dayId: proposal.params.dayId, stopId: proposal.params.stopId };
    case "suggest_stops":
      return { picker: "suggestions", dayId: proposal.params.dayId, request: shortRequest(proposal.params.request) };
    case "replace_meal":
      return { picker: "meal", ...proposal.params, request: shortRequest(proposal.params.request) };
    case "replace_accommodation":
      return { picker: "accommodation", dayId: proposal.params.dayId };
    default:
      return null;
  }
}

interface Applied {
  days: Days;
  /** A removed stop, for the trash (as DELETE /stops/[stopId] keeps it). */
  trashed?: { dayId: string; dayNumber: number; originalIndex: number; stop: Rec };
  /** A day whose transport lines the screen should recalculate, as after a drag. */
  recalculateDayId?: string;
  /** A picker to open once the change shows, e.g. for a meal slot restored empty. */
  then?: PickerRequest;
}

/** Applies a one-step change to a copy of the days; null for a change that needs a pick. */
export function applyDirect(days: Days, proposal: ChatProposalDraft): Applied | null {
  const next = structuredClone(days);
  if (proposal.action === "restructure") return null;
  const dayIndex = next.findIndex((d) => d.id === proposal.params.dayId);
  const day = next[dayIndex];
  if (!day) return null;
  switch (proposal.action) {
    case "remove_stop": {
      const stops = day.stops as Rec[];
      const index = stops.findIndex((s) => s.id === proposal.params.stopId);
      const [stop] = stops.splice(index, 1);
      const dayNumber = typeof day.day === "number" ? day.day : dayIndex + 1;
      return {
        days: next,
        trashed: { dayId: proposal.params.dayId, dayNumber, originalIndex: index, stop },
        recalculateDayId: proposal.params.dayId,
      };
    }
    case "move_stop": {
      const stops = day.stops as Rec[];
      const [stop] = stops.splice(stops.findIndex((s) => s.id === proposal.params.stopId), 1);
      stops.splice(proposal.params.toIndex, 0, stop);
      day.stops = stops.map((s, i) => ({ ...s, orderIndex: i }));
      return { days: next, recalculateDayId: proposal.params.dayId };
    }
    case "remove_meal":
      next[dayIndex] = skipMeal(day, proposal.params.mealType);
      return { days: next };
    case "restore_meal":
      next[dayIndex] = unskipMeal(day, proposal.params.mealType);
      return { days: next, then: { picker: "meal", ...proposal.params, request: null } };
    default:
      return null;
  }
}

function conflict(body: Rec) {
  return Response.json(body, { status: 409 });
}

/** Moves a pending proposal to `status`; false when it had already left "pending". */
async function claim(proposalId: string, status: "applied" | "cancelled" | "stale"): Promise<boolean> {
  const { count } = await prisma.chatProposal.updateMany({
    where: { id: proposalId, status: "pending" },
    data: { status, resolvedAt: new Date() },
  });
  return count === 1;
}

class AlreadyResolved extends Error {}

const alreadyResolved = () => conflict({ error: "這個提案已經處理過了", code: "proposal_resolved" });

export async function decideProposal(itinerary: OwnedItinerary, proposalId: string, decision: ProposalDecision): Promise<Response> {
  const stored = await prisma.chatProposal.findFirst({
    where: { id: proposalId, message: { itineraryId: itinerary.id } },
  });
  if (!stored) return Response.json({ error: "Proposal not found" }, { status: 404 });
  if (stored.status !== "pending") return alreadyResolved();
  const proposal = { action: stored.action, params: JSON.parse(stored.params) } as ChatProposalDraft;

  if (decision === "cancel") {
    return (await claim(proposalId, "cancelled")) ? Response.json({ status: "cancelled" }) : alreadyResolved();
  }
  if (decision === "picked") {
    // The pick (or the restructure) was made through its own route, so the
    // trip has already moved past the card: checking it again would call
    // the change it just made stale. Only record it.
    if (proposal.action !== "restructure" && !pickerFor(proposal)) {
      return Response.json({ error: "這個提案不需要挑選" }, { status: 400 });
    }
    return (await claim(proposalId, "applied")) ? Response.json({ status: "applied" }) : alreadyResolved();
  }
  if (proposal.action === "restructure") {
    // Like a picker: the screen shows the preview, then sends the request to
    // restructure/route.ts (which charges its own quota) and reports back.
    const plan = planRestructure(itinerary.days, itinerary.config, proposal.params.cities);
    if (!plan.ok) {
      await claim(proposalId, "stale");
      return conflict({ status: "stale", error: `${plan.problem}，請重新問一次。`, code: "proposal_stale" });
    }
    return Response.json({ status: "pending", restructure: { request: plan.request, preview: plan.preview } });
  }

  const days = (Array.isArray(itinerary.days) ? itinerary.days : []) as Days;
  const problem = proposalProblem(days, proposal);
  if (problem) {
    await claim(proposalId, "stale");
    return conflict({ status: "stale", error: `${problem}，請重新問一次。`, code: "proposal_stale" });
  }

  const picker = pickerFor(proposal);
  if (picker) {
    // Nothing changes until the owner picks; then the screen reports it.
    return Response.json({ status: "pending", picker });
  }

  const applied = applyDirect(days, proposal)!;
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.chatProposal.updateMany({
        where: { id: proposalId, status: "pending" },
        data: { status: "applied", resolvedAt: new Date() },
      });
      if (count !== 1) throw new AlreadyResolved();
      await tx.itinerary.update({ where: { id: itinerary.id }, data: { days: j(applied.days) } });
      if (applied.trashed) {
        await tx.deletedStop.create({
          data: { itineraryId: itinerary.id, ...applied.trashed, stop: j(applied.trashed.stop) },
        });
      }
    });
  } catch (error) {
    if (error instanceof AlreadyResolved) return alreadyResolved();
    throw error;
  }
  return Response.json({
    status: "applied",
    recalculateDayId: applied.recalculateDayId ?? null,
    ...(applied.then && { picker: applied.then }),
  });
}
