import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

// Signed-out visitors get a guest identity: a User row with isGuest=true,
// referenced by an httpOnly cookie whose value is "<userId>.<hmac>". The HMAC
// (keyed by AUTH_SECRET) means the cookie can't be forged or pointed at
// another guest's id. plan/access-control.md §5, §7.

export const GUEST_COOKIE = "guest_id";
export const GUEST_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is required to sign guest cookies");
  return s;
}

function mac(userId: string): string {
  return createHmac("sha256", secret()).update(`guest:${userId}`).digest("base64url");
}

export function signGuestId(userId: string): string {
  return `${userId}.${mac(userId)}`;
}

// Returns the guest's user id if the cookie value is intact, else null.
export function verifyGuestCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(userId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}

export function guestCookieHeader(userId: string): string {
  const parts = [
    `${GUEST_COOKIE}=${signGuestId(userId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(GUEST_TTL_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export async function createGuestUser() {
  return prisma.user.create({ data: { isGuest: true }, select: { id: true } });
}

export function guestExpiry(now = Date.now()): Date {
  return new Date(now + GUEST_TTL_MS);
}

// On sign-in: hand the guest's itineraries to the signed-in user, make them
// permanent, and drop the now-empty guest row. Expired itineraries are left
// behind (and go with the guest row via cascade) — they were already gone
// as far as the visitor could see.
export async function claimGuestItineraries(guestUserId: string, userId: string): Promise<number> {
  if (guestUserId === userId) return 0;
  const guest = await prisma.user.findFirst({ where: { id: guestUserId, isGuest: true }, select: { id: true } });
  if (!guest) return 0;
  const [moved] = await prisma.$transaction([
    prisma.itinerary.updateMany({
      where: { userId: guestUserId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      data: { userId, expiresAt: null },
    }),
    prisma.user.delete({ where: { id: guestUserId } }),
  ]);
  return moved.count;
}
