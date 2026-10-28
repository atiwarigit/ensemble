import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { account } from "@/db/schema/auth";
import { getWorkspaceMembership } from "@/lib/services/access";
import { acceptInvite, createInvite, findOpenInvite, revokeInvite } from "@/lib/services/invites";
import { createMember, createWorkspace } from "./fixtures";

const password = "correct-horse-battery";

describe("invites", () => {
  it("creates an account with the invited role, once", async () => {
    const ws = await createWorkspace();
    const owner = await createMember(ws.id, "owner");
    const email = `new-${Date.now()}@example.com`;
    const { token } = await createInvite(owner, { email, role: "viewer" });

    const { userId } = await acceptInvite({ token, name: "New", password });
    expect(await getWorkspaceMembership(db, userId)).toMatchObject({ workspaceId: ws.id, role: "viewer" });
    const [acct] = await db.select().from(account).where(eq(account.userId, userId));
    expect(acct.providerId).toBe("credential");
    expect(acct.password).not.toContain(password);

    await expect(acceptInvite({ token, name: "Again", password })).rejects.toMatchObject({ code: "invalid" });
  });

  it("only owners can invite owners, and members can't invite", async () => {
    const ws = await createWorkspace();
    const admin = await createMember(ws.id, "admin");
    const member = await createMember(ws.id, "member");
    await expect(createInvite(admin, { email: "o@example.com", role: "owner" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createInvite(member, { email: "m@example.com", role: "member" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("revoked and replaced invites stop working", async () => {
    const ws = await createWorkspace();
    const owner = await createMember(ws.id, "owner");
    const first = await createInvite(owner, { email: "r@example.com", role: "member" });
    const second = await createInvite(owner, { email: "r@example.com", role: "member" });
    expect(await findOpenInvite(db, first.token)).toBeNull();
    await revokeInvite(owner, second.invite.id);
    expect(await findOpenInvite(db, second.token)).toBeNull();
  });

  it("rejects short passwords", async () => {
    const ws = await createWorkspace();
    const owner = await createMember(ws.id, "owner");
    const { token } = await createInvite(owner, { email: "short@example.com", role: "member" });
    await expect(acceptInvite({ token, name: "Short", password: "short" })).rejects.toThrow();
  });
});
