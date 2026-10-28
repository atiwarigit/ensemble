import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { account, user } from "@/db/schema/auth";
import { invites, workspaceMembers, workspaces } from "@/db/schema/tenancy";
import { recordAudit, recordSystemAudit } from "./audit";
import { requireWorkspaceRole } from "./access";
import { conflict, forbidden, invalid, notFound, type ServiceContext } from "./context";

const INVITE_TTL_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 12;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export async function createInvite(ctx: ServiceContext, input: z.input<typeof inviteInput>) {
  requireWorkspaceRole(ctx, "admin");
  const data = inviteInput.parse(input);
  if (data.role === "owner" && ctx.workspaceRole !== "owner") throw forbidden("Only owners can invite owners.");

  return db.transaction(async (tx) => {
    const [existingUser] = await tx
      .select({ id: user.id })
      .from(user)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, user.id))
      .where(and(eq(user.email, data.email), eq(workspaceMembers.workspaceId, ctx.workspaceId)));
    if (existingUser) throw conflict("That person is already a member.");

    // Re-inviting replaces any outstanding invite for the same email.
    await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invites.workspaceId, ctx.workspaceId),
          eq(invites.email, data.email),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      );

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
    const [invite] = await tx
      .insert(invites)
      .values({
        workspaceId: ctx.workspaceId,
        email: data.email,
        role: data.role,
        tokenHash: hashToken(token),
        invitedBy: ctx.userId,
        expiresAt,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "workspace.invite.created",
      entityType: "invite",
      entityId: invite.id,
      after: { email: data.email, role: data.role, expiresAt },
    });
    return { invite, token };
  });
}

export async function revokeInvite(ctx: ServiceContext, inviteId: string) {
  requireWorkspaceRole(ctx, "admin");
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invites.id, inviteId),
          eq(invites.workspaceId, ctx.workspaceId),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      )
      .returning();
    if (!invite) throw notFound("Invite not found or already used.");
    await recordAudit(tx, ctx, {
      action: "workspace.invite.revoked",
      entityType: "invite",
      entityId: invite.id,
      before: { email: invite.email, role: invite.role },
    });
  });
}

export async function listPendingInvites(exec: Executor, ctx: ServiceContext) {
  requireWorkspaceRole(ctx, "admin");
  return exec
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
      invitedBy: user.name,
    })
    .from(invites)
    .leftJoin(user, eq(user.id, invites.invitedBy))
    .where(
      and(
        eq(invites.workspaceId, ctx.workspaceId),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(invites.createdAt));
}

/** Public lookup used by the invite acceptance page. */
export async function findOpenInvite(exec: Executor, token: string) {
  const [row] = await exec
    .select({ invite: invites, workspaceName: workspaces.name })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .where(
      and(
        eq(invites.tokenHash, hashToken(token)),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, sql`now()`),
      ),
    );
  return row ?? null;
}

export const acceptInviteInput = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(1, "Name is required").max(80),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(128),
});

/**
 * Public sign-up is disabled in Better Auth, so accepting an invite is the only way an account
 * is created. Writes the user, credential account, membership and audit event in one transaction.
 */
export async function acceptInvite(
  input: z.input<typeof acceptInviteInput>,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const data = acceptInviteInput.parse(input);
  const passwordHash = await hashPassword(data.password);

  return db.transaction(async (tx) => {
    const found = await findOpenInvite(tx, data.token);
    if (!found) throw invalid("This invite link is invalid or has expired.");
    const { invite } = found;

    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, invite.email));
    if (existing) throw conflict("An account with this email already exists. Sign in instead.");

    const userId = randomUUID();
    await tx.insert(user).values({ id: userId, name: data.name, email: invite.email, emailVerified: true });
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    });
    await tx.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId, role: invite.role });
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
    await recordSystemAudit(
      tx,
      { workspaceId: invite.workspaceId, actorUserId: userId, ip: meta.ip, userAgent: meta.userAgent },
      {
        action: "workspace.invite.accepted",
        entityType: "invite",
        entityId: invite.id,
        after: { userId, email: invite.email, role: invite.role },
      },
    );
    return { userId, email: invite.email };
  });
}
