import { NextResponse } from "next/server";
import { authorizeItinerary, authorizeItineraryRead } from "@/lib/auth/ownership";
import { internalErrorResponse } from "@/lib/apiError";
import { chatAllowanceFor, loadConversation, SendChatSchema, sendChatMessage } from "@/lib/chat/conversation";

// The itinerary chat assistant (PLAN-004, ADR-0013): signed-in owners only.
// On an admin-published example anyone may read the owner's conversation, as
// a read-only demo; sending stays the owner's. Logic lives in
// src/lib/chat/conversation.ts.

function guestsSignInFirst() {
  return NextResponse.json({ error: "登入後才能使用聊天助理。", code: "sign_in_required" }, { status: 403 });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await authorizeItineraryRead(id);
    if (!access.ok) return access.response;
    if (access.access === "public") {
      return NextResponse.json({ messages: await loadConversation(id), allowance: null, readOnly: true });
    }
    if (!access.actor || access.actor.kind === "guest") return guestsSignInFirst();
    const [messages, allowance] = await Promise.all([loadConversation(id), chatAllowanceFor(access.actor, request)]);
    return NextResponse.json({ messages, allowance, readOnly: false });
  } catch (error) {
    return internalErrorResponse("Chat GET", error, "Failed to load the conversation");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = SendChatSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const access = await authorizeItinerary(id);
    if (!access.ok) return access.response;
    if (access.actor.kind === "guest") return guestsSignInFirst();
    return await sendChatMessage(request, access.actor, access.itinerary, parsed.data);
  } catch (error) {
    return internalErrorResponse("Chat POST", error, "Failed to send the message");
  }
}
