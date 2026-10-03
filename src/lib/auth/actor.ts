import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/auth/adminEmails";

// Who is making this request. Only signed-in Google users for now; guests
// (plan/access-control.md §5, PR 3) will be another `kind` here.
export type Actor = {
  kind: "user";
  userId: string;
  email: string;
  isAdmin: boolean;
};

export function actorFromSession(
  session: { user?: { id?: string | null; email?: string | null } | null } | null,
): Actor | null {
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) return null;
  return { kind: "user", userId, email, isAdmin: isAdminEmail(email) };
}

export async function getActor(): Promise<Actor | null> {
  return actorFromSession(await auth());
}
