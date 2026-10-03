import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/adminEmails";

// One User row per Google email, created on first sign-in. The row's id (not
// Google's account id) is what itineraries are owned by, so it's what goes
// into the session.
export async function upsertUserByEmail(email: string, name?: string | null) {
  const normalized = normalizeEmail(email);
  return prisma.user.upsert({
    where: { email: normalized },
    create: { email: normalized, name: name ?? null },
    update: name ? { name } : {},
    select: { id: true, email: true },
  });
}
