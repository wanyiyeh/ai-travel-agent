import { NextResponse } from "next/server";
import { authorizeItinerary } from "@/lib/auth/ownership";
import { internalErrorResponse } from "@/lib/apiError";
import { decideProposal, ProposalDecisionSchema } from "@/lib/chat/proposals";

// Confirm, cancel, or report the pick for one chat proposal (PLAN-004).
// Logic lives in src/lib/chat/proposals.ts.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; proposalId: string }> }) {
  try {
    const { id, proposalId } = await params;
    const parsed = ProposalDecisionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const access = await authorizeItinerary(id);
    if (!access.ok) return access.response;
    if (access.actor.kind === "guest") {
      return NextResponse.json({ error: "登入後才能使用聊天助理。", code: "sign_in_required" }, { status: 403 });
    }
    return await decideProposal(access.itinerary, proposalId, parsed.data.decision);
  } catch (error) {
    return internalErrorResponse("Chat proposal", error, "Failed to update the proposal");
  }
}
