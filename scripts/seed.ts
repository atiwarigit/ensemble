import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "@/db";
import { account, user } from "@/db/schema/auth";
import { workspaceMembers, workspaces, type WorkspaceRole } from "@/db/schema/tenancy";
import { recordSystemAudit } from "@/lib/services/audit";

const WORKSPACE_NAME = "dai + drm";
const DEV_PASSWORD = "ensemble-dev-password";

async function ensureUser(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
  email: string,
  name: string,
  role: WorkspaceRole,
  password: string,
) {
  const [existing] = await tx.select().from(user).where(eq(user.email, email));
  if (existing) {
    console.log(`  = ${email} already exists`);
    return existing.id;
  }
  const id = randomUUID();
  await tx.insert(user).values({ id, email, name, emailVerified: true });
  await tx.insert(account).values({
    id: randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(password),
  });
  await tx.insert(workspaceMembers).values({ workspaceId, userId: id, role });
  await recordSystemAudit(tx, { workspaceId }, {
    action: "workspace.member.seeded",
    entityType: "workspace_member",
    entityId: id,
    after: { email, role },
  });
  console.log(`  + ${email} (${role})`);
  return id;
}

async function main() {
  const ownerEmail = (process.env.BOOTSTRAP_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!ownerEmail) throw new Error("BOOTSTRAP_OWNER_EMAIL is required");
  const password = process.env.SEED_PASSWORD || (process.env.NODE_ENV === "production" ? "" : DEV_PASSWORD);
  if (!password) throw new Error("SEED_PASSWORD is required in production");

  await db.transaction(async (tx) => {
    let [ws] = await tx.select().from(workspaces).where(eq(workspaces.name, WORKSPACE_NAME));
    if (!ws) {
      [ws] = await tx.insert(workspaces).values({ name: WORKSPACE_NAME }).returning();
      await recordSystemAudit(tx, { workspaceId: ws.id }, {
        action: "workspace.created",
        entityType: "workspace",
        entityId: ws.id,
        after: { name: WORKSPACE_NAME },
      });
      console.log(`+ workspace "${WORKSPACE_NAME}"`);
    }

    await ensureUser(tx, ws.id, ownerEmail, process.env.BOOTSTRAP_OWNER_NAME || "Romel", "owner", password);
    const memberEmail = (process.env.SEED_MEMBER_EMAIL ?? "").trim().toLowerCase();
    if (memberEmail) {
      await ensureUser(tx, ws.id, memberEmail, process.env.SEED_MEMBER_NAME || "Nikki", "member", password);
    }
  });

  if (!process.env.SEED_PASSWORD) console.log(`\nDev password for seeded users: ${DEV_PASSWORD}`);
  await sqlClient.end();
}

main().catch(async (err) => {
  console.error(err);
  await sqlClient.end();
  process.exit(1);
});
