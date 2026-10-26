import { prisma } from "@/lib/db";

/**
 * Deletes a signed-in user and everything that's theirs, at once and for
 * good: the itineraries go with the user row, and their trash and candidate
 * logs with the itineraries (onDelete: Cascade). Their usage records go too
 * (the user's call, #283), so the quota of an account deleted and signed in
 * again starts afresh; rate limits and the daily budgets still apply.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.usageEvent.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}
