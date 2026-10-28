import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { workspaceMembers, workspaces, type WorkspaceRole } from "@/db/schema/tenancy";
import type { ServiceContext } from "@/lib/services/context";

export async function createWorkspace(name = `ws-${randomUUID().slice(0, 8)}`) {
  const [ws] = await db.insert(workspaces).values({ name }).returning();
  return ws;
}

export async function createMember(workspaceId: string, role: WorkspaceRole, name: string = role): Promise<ServiceContext> {
  const id = randomUUID();
  await db.insert(user).values({ id, name, email: `${id}@test.local`, emailVerified: true });
  await db.insert(workspaceMembers).values({ workspaceId, userId: id, role });
  return { userId: id, workspaceId, workspaceRole: role, actorType: "user" };
}
