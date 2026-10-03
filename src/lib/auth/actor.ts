import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/auth/adminEmails";
import { GUEST_COOKIE, verifyGuestCookie } from "@/lib/auth/guest";

// Who is making this request: a signed-in Google user, or a guest identified
// by the signed guest cookie (plan/access-control.md §5). Both own
// itineraries by userId, so ownership checks treat them the same.
export type Actor =
  | { kind: "user"; userId: string; email: string; isAdmin: boolean }
  | { kind: "guest"; userId: string; email: null; isAdmin: false };

export function actorFromSession(
  session: { user?: { id?: string | null; email?: string | null } | null } | null,
): Actor | null {
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) return null;
  return { kind: "user", userId, email, isAdmin: isAdminEmail(email) };
}

export async function guestActorFromCookie(value: string | undefined): Promise<Actor | null> {
  const guestId = verifyGuestCookie(value);
  if (!guestId) return null;
  // The row must still exist and still be a guest (it's deleted once claimed).
  const guest = await prisma.user.findFirst({ where: { id: guestId, isGuest: true }, select: { id: true } });
  return guest ? { kind: "guest", userId: guest.id, email: null, isAdmin: false } : null;
}

export async function getActor(): Promise<Actor | null> {
  const fromSession = actorFromSession(await auth());
  if (fromSession) return fromSession;
  const jar = await cookies();
  return guestActorFromCookie(jar.get(GUEST_COOKIE)?.value);
}
