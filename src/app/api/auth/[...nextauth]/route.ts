import NextAuth, { Session } from "next-auth";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { isPaidUser } from "@/lib/redis";

interface ExtendedSession extends Session {
  isPaid?: boolean;
}

// SECURITY: no fallback secret. The previous "dev-secret-change-in-production"
// string was a hardcoded literal committed to this (public) repo — if
// NEXTAUTH_SECRET was ever unset on Vercel, every session was signed with a
// secret anyone reading this file could see, meaning anyone could forge a
// valid session cookie for any account. There is no safe fallback for a
// signing secret; if it's missing, the providers below are disabled instead
// of running with a known-to-everyone key.
const nextAuthSecret = process.env.NEXTAUTH_SECRET;
const providersConfigured = !!(
  nextAuthSecret &&
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET &&
  process.env.APPLE_ID && process.env.APPLE_SECRET
);

const { handlers } = NextAuth({
  secret: nextAuthSecret, // undefined here throws at request time rather than silently signing with a public string
  providers: providersConfigured
    ? [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          allowDangerousEmailAccountLinking: true,
        }),
        Apple({
          clientId: process.env.APPLE_ID!,
          clientSecret: process.env.APPLE_SECRET!,
        }),
      ]
    : [], // no real credentials configured — no providers registered, sign-in buttons will correctly no-op instead of running on placeholder secrets
  callbacks: {
    async session({ session }): Promise<ExtendedSession> {
      const extended = session as ExtendedSession;
      if (session?.user?.email) {
        try {
          extended.isPaid = await isPaidUser(session.user.email);
        } catch {
          extended.isPaid = false;
        }
      }
      return extended;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});

export const { GET, POST } = handlers;
