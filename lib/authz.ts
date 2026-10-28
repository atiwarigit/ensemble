import "server-only";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { getWorkspaceMembership, hasWorkspaceRole } from "@/lib/services/access";
import { errorMessage } from "@/lib/errors";
import { ServiceError, type ServiceContext } from "@/lib/services/context";

export { errorMessage };

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export function twoFactorRequired() {
  return process.env.REQUIRE_2FA_FOR_ADMINS !== "false";
}

export type AppContext = {
  user: NonNullable<Awaited<ReturnType<typeof getSession>>>["user"];
  ctx: ServiceContext;
};

/**
 * Resolves the signed-in user and their workspace into a ServiceContext, or redirects.
 * Owners/admins without TOTP are sent to enrolment before they can do anything else.
 */
export const requireAppContext = cache(async (opts: { allowMissing2fa?: boolean } = {}): Promise<AppContext> => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const membership = await getWorkspaceMembership(db, session.user.id);
  if (!membership) redirect("/sign-in?error=no-workspace");

  if (
    !opts.allowMissing2fa &&
    twoFactorRequired() &&
    hasWorkspaceRole(membership.role, "admin") &&
    !session.user.twoFactorEnabled
  ) {
    redirect("/setup-2fa");
  }

  const h = await headers();
  return {
    user: session.user,
    ctx: {
      userId: session.user.id,
      workspaceId: membership.workspaceId,
      workspaceRole: membership.role,
      actorType: "user",
      requestId: h.get("x-vercel-id") ?? randomUUID(),
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
      userAgent: h.get("user-agent"),
    },
  };
});

/** For route handlers that return JSON: same checks as requireAppContext, but null instead of a redirect. */
export async function getApiContext(): Promise<AppContext | null> {
  const session = await getSession();
  if (!session) return null;
  const membership = await getWorkspaceMembership(db, session.user.id);
  if (!membership) return null;
  if (twoFactorRequired() && hasWorkspaceRole(membership.role, "admin") && !session.user.twoFactorEnabled) return null;
  const h = await headers();
  return {
    user: session.user,
    ctx: {
      userId: session.user.id,
      workspaceId: membership.workspaceId,
      workspaceRole: membership.role,
      actorType: "user",
      requestId: h.get("x-vercel-id") ?? randomUUID(),
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
      userAgent: h.get("user-agent"),
    },
  };
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Runs a Server Action body with an authenticated context and converts service errors into results. */
export async function runAction<T>(fn: (app: AppContext) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  const app = await requireAppContext();
  try {
    const data = await fn(app);
    return { ok: true, data, message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** For pages: converts a service not-found/forbidden into the Next.js not-found page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ServiceError && (err.code === "not_found" || err.code === "forbidden")) notFound();
    throw err;
  }
}
