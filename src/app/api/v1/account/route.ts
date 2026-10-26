import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_NAME_LENGTH } from "@/lib/inputLimits";
import { getActor } from "@/lib/auth/actor";
import { confirmsEmail } from "@/lib/auth/confirmsEmail";
import { deleteAccount } from "@/lib/auth/deleteAccount";
import { internalErrorResponse } from "@/lib/apiError";

const RequestSchema = z.object({
  // The account's email, typed again so a stray click deletes nothing.
  confirmEmail: z.string().max(MAX_NAME_LENGTH),
});

// Deletes the signed-in user's account and all their data (#283). The page
// signs the browser out afterwards; the session alone would otherwise bring
// the user row back on the next request (actor.ts withStoredUser).
export async function DELETE(request: Request) {
  try {
    const actor = await getActor();
    if (!actor || actor.kind !== "user") {
      return NextResponse.json({ error: "請先登入" }, { status: 401 });
    }

    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !confirmsEmail(parsed.data.confirmEmail, actor.email)) {
      return NextResponse.json({ error: "email 與帳號不符" }, { status: 400 });
    }

    await deleteAccount(actor.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return internalErrorResponse("Delete Account Error", error, "Failed to delete account");
  }
}
