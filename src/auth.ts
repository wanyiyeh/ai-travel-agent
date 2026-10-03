import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { upsertUserByEmail } from "@/lib/auth/users";

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
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.userId === "string") session.user.id = token.userId;
      return session;
    },
  },
});
