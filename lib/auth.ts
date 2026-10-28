import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { getSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { account, session, twoFactor as twoFactorTable, user, verification } from "@/db/schema/auth";
import { getWorkspaceMembership } from "@/lib/services/access";
import { recordSystemAudit } from "@/lib/services/audit";
import { MIN_PASSWORD_LENGTH } from "@/lib/services/invites";

const AUDITED_PATHS: Record<string, string> = {
  "/sign-in/email": "auth.signed_in",
  "/two-factor/verify-totp": "auth.signed_in",
  "/two-factor/verify-backup-code": "auth.signed_in",
};

/** Attributes pre-session events (failed or half-finished sign-ins) to the account's workspace. */
async function workspaceForEmail(email: string | null) {
  if (!email) return undefined;
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  return u ? ((await getWorkspaceMembership(db, u.id))?.workspaceId ?? undefined) : undefined;
}

function requestMeta(headers: Headers | undefined) {
  return {
    ip: headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers?.get("x-real-ip") ?? null,
    userAgent: headers?.get("user-agent") ?? null,
  };
}

export const auth = betterAuth({
  appName: "Ensemble",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification, twoFactor: twoFactorTable },
  }),
  emailAndPassword: {
    enabled: true,
    // Accounts are only created by accepting an invite (lib/services/invites.ts).
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  plugins: [twoFactor({ issuer: "Ensemble" }), nextCookies()],
  hooks: {
    // Sign-out is audited before it runs: afterwards the session (and so the actor) is gone.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-out") return;
      const current = await getSessionFromCtx(ctx).catch(() => null);
      if (!current) return;
      const m = await getWorkspaceMembership(db, current.user.id);
      await recordSystemAudit(
        db,
        { ...requestMeta(ctx.request?.headers ?? ctx.headers), workspaceId: m?.workspaceId, actorUserId: current.user.id },
        { action: "auth.signed_out", entityType: "user", entityId: current.user.id },
      );
    }),
    after: createAuthMiddleware(async (ctx) => {
      const meta = requestMeta(ctx.request?.headers ?? ctx.headers);
      const returned = ctx.context.returned as { twoFactorRedirect?: boolean } | Error | undefined;
      const failed = returned instanceof Error;

      if (ctx.path === "/sign-in/email" && failed) {
        const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : null;
        await recordSystemAudit(
          db,
          { ...meta, workspaceId: await workspaceForEmail(email) },
          { action: "auth.sign_in_failed", entityType: "user", after: { email } },
        );
        return;
      }
      if (failed) return;

      // Verifying a TOTP code while already signed in completes enrolment; Better Auth issues a
      // fresh session in both cases, so the incoming cookie is what tells them apart.
      const headers = ctx.request?.headers ?? ctx.headers;
      if (ctx.path === "/two-factor/verify-totp" && headers && getSessionCookie(headers) && ctx.context.newSession) {
        const u = ctx.context.newSession.user;
        const m = await getWorkspaceMembership(db, u.id);
        await recordSystemAudit(
          db,
          { ...meta, workspaceId: m?.workspaceId, actorUserId: u.id },
          { action: "auth.2fa.enabled", entityType: "user", entityId: u.id },
        );
        return;
      }
      if (ctx.path === "/two-factor/disable") {
        const u = ctx.context.session?.user;
        if (!u) return;
        const m = await getWorkspaceMembership(db, u.id);
        await recordSystemAudit(
          db,
          { ...meta, workspaceId: m?.workspaceId, actorUserId: u.id },
          { action: "auth.2fa.disabled", entityType: "user", entityId: u.id },
        );
        return;
      }

      const action = AUDITED_PATHS[ctx.path];
      if (!action) return;
      if (action === "auth.signed_in") {
        const newSession = ctx.context.newSession;
        // For 2FA users the password step's session is discarded by the plugin; the real sign-in
        // is logged when the code is verified.
        const twoFactorPending =
          ctx.path === "/sign-in/email" &&
          ((newSession?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled ||
            (returned && "twoFactorRedirect" in returned && returned.twoFactorRedirect));
        if (twoFactorPending) {
          const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : null;
          await recordSystemAudit(
            db,
            { ...meta, workspaceId: await workspaceForEmail(email), actorUserId: newSession?.user.id },
            { action: "auth.password_verified_2fa_pending", entityType: "user", entityId: newSession?.user.id ?? null },
          );
          return;
        }
        if (!newSession) return;
        const m = await getWorkspaceMembership(db, newSession.user.id);
        await recordSystemAudit(
          db,
          { ...meta, workspaceId: m?.workspaceId, actorUserId: newSession.user.id },
          {
            action,
            entityType: "user",
            entityId: newSession.user.id,
            after: { method: ctx.path === "/sign-in/email" ? "password" : "password+totp" },
          },
        );
      }
    }),
  },
});

export type AuthSession = typeof auth.$Infer.Session;
