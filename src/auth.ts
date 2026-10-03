import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { cookies } from "next/headers";
import { upsertUserByEmail } from "@/lib/auth/users";
import { GUEST_COOKIE, claimGuestItineraries, verifyGuestCookie } from "@/lib/auth/guest";

// If the visitor generated itineraries as a guest before signing in, they
// move to the account and stop expiring (plan/access-control.md §5).
// Best-effort: a failure here must not block the sign-in itself.
async function claimGuestOnSignIn(userId: string) {
  try {
    const jar = await cookies();
    const guestId = verifyGuestCookie(jar.get(GUEST_COOKIE)?.value);
    if (!guestId) return;
    await claimGuestItineraries(guestId, userId);
    jar.delete(GUEST_COOKIE);
  } catch (err) {
    console.error("[auth] claiming guest itineraries failed", err);
  }
}

// Google sign-in only (plan/access-control.md §0). Reads AUTH_SECRET,
// AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
//
// JWT sessions: the signed cookie carries our User id, so no Session/Account
// tables are needed (keeps this independent of the Postgres migration in
// plan/docker-and-ci.md).
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    // Only accept accounts whose email Google has verified — the email is
    // what identifies the user (and admins) here.
    signIn({ profile }) {
      return Boolean(profile?.email && profile.email_verified);
    },
    // `profile` is only present on the sign-in request itself; later
    // requests just carry the token forward.
    async jwt({ token, profile }) {
      if (profile?.email) {
        const user = await upsertUserByEmail(profile.email, profile.name);
        token.userId = user.id;
        token.email = user.email;
        await claimGuestOnSignIn(user.id);
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.userId === "string") session.user.id = token.userId;
      return session;
    },
  },
});
