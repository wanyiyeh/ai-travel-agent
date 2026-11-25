import { isTransitStop, transitStopIndex } from "@/lib/transitStop";
import type { MealType } from "@/types/itinerary";
import type { ChatProposalDraft } from "@/lib/chat/assistant";

// What a chat proposal may change (ADR-0013), checked twice: when the
// assistant proposes it (one that breaks a rule is dropped) and again when
// the owner confirms it (the trip may have changed since; it's then stale).
// The rules match the buttons': transit rides, booked events and locked
// days stay as they are.

type Rec = Record<string, unknown>;

const records = (value: unknown): Rec[] =>
  Array.isArray(value) ? value.filter((v): v is Rec => Boolean(v) && typeof v === "object") : [];

function dayById(days: unknown, dayId: string): Rec | undefined {
  return records(days).find((day) => day.id === dayId);
}

function mealOf(day: Rec, mealType: MealType): Rec | undefined {
  const meal = (day.meals as Record<string, unknown> | undefined)?.[mealType];
  return meal && typeof meal === "object" ? (meal as Rec) : undefined;
}

function stopProblem(day: Rec, stopId: string): string | null {
  if (day.isLocked === true) return "這一天整天鎖定，不能修改";
  const stop = records(day.stops).find((s) => s.id === stopId);
  if (!stop) return "這個景點已經不在行程裡";
  if (isTransitStop(stop, day)) return "城市間的交通不能修改";
  if (stop.fixedEvent) return "預訂好的固定行程不能修改";
  return null;
}

/** Why the proposal can't be applied to these days, or null when it can. */
export function proposalProblem(days: unknown, proposal: ChatProposalDraft): string | null {
  if (proposal.action === "restructure") return null; // checked by the restructure route (#372)
  const day = dayById(days, proposal.params.dayId);
  if (!day) return "這一天已經不在行程裡";

  switch (proposal.action) {
    case "remove_stop":
    case "replace_stop":
      return stopProblem(day, proposal.params.stopId);
    case "move_stop": {
      const problem = stopProblem(day, proposal.params.stopId);
      if (problem) return problem;
      const stops = records(day.stops);
      if (proposal.params.toIndex >= stops.length) return "移動後的位置超出這一天的景點數";
      const transitAt = transitStopIndex(stops as { kind?: unknown }[], day);
      const from = stops.findIndex((s) => s.id === proposal.params.stopId);
      const crosses = transitAt >= 0 && (from < transitAt) !== (proposal.params.toIndex < transitAt);
      return crosses ? "景點不能移到城市間交通的另一邊" : null;
    }
    case "suggest_stops":
      return day.isLocked === true ? "這一天整天鎖定，不能修改" : null;
    case "replace_meal":
      return mealOf(day, proposal.params.mealType)?.fixedEvent ? "訂好位的餐廳不能更換" : null;
    case "remove_meal": {
      const meal = mealOf(day, proposal.params.mealType);
      if (!meal) return "這一餐已經不在行程裡";
      return meal.fixedEvent ? "訂好位的餐廳不能刪除" : null;
    }
    case "restore_meal": {
      const skipped = Array.isArray(day.skippedMeals) ? day.skippedMeals : [];
      return skipped.includes(proposal.params.mealType) ? null : "這一餐沒有被刪除";
    }
    case "replace_accommodation":
      return day.accommodation && typeof day.accommodation === "object" ? null : "這一天沒有住宿可以更換";
  }
}
