import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents } from "@/db/schema/audit";
import { recordAudit, verifyAuditChain } from "@/lib/services/audit";
import { createMember, createWorkspace } from "./fixtures";

describe("audit log", () => {
  it("chains each event to the previous one", async () => {
    const ws = await createWorkspace();
    const ctx = await createMember(ws.id, "owner");
    const a = await recordAudit(db, ctx, { action: "test.first", after: { n: 1 } });
    const b = await recordAudit(db, ctx, { action: "test.second", after: { n: 2 } });
    const [row] = await db.select().from(auditEvents).where(sql`${auditEvents.id} = ${b.id}`);
    expect(row.prevHash).toBe(a.hash);
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    const chain = await verifyAuditChain(db);
    expect(chain.ok).toBe(true);
    expect(chain.head?.id).toBe(b.id);
  });

  it("keeps the chain ordered under concurrent writes", async () => {
    const ws = await createWorkspace();
    const ctx = await createMember(ws.id, "owner");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.transaction((tx) => recordAudit(tx, ctx, { action: "test.concurrent", after: { i } })),
      ),
    );
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });

  it("rejects UPDATE, DELETE and TRUNCATE", async () => {
    const ws = await createWorkspace();
    const ctx = await createMember(ws.id, "owner");
    const { id } = await recordAudit(db, ctx, { action: "test.immutable" });
    const appendOnly = { cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }) };
    await expect(db.execute(sql`update audit_events set action = 'tampered' where id = ${id}`)).rejects.toMatchObject(
      appendOnly,
    );
    await expect(db.execute(sql`delete from audit_events where id = ${id}`)).rejects.toMatchObject(appendOnly);
    await expect(db.execute(sql`truncate audit_events`)).rejects.toMatchObject(appendOnly);
  });

  it("detects tampering when the trigger is bypassed", async () => {
    const ws = await createWorkspace();
    const ctx = await createMember(ws.id, "owner");
    const { id } = await recordAudit(db, ctx, { action: "test.tamper", after: { amount: 100 } });
    await db.transaction(async (tx) => {
      await tx.execute(sql`alter table audit_events disable trigger audit_events_no_update_delete`);
      await tx.execute(sql`update audit_events set after = '{"amount": 1}' where id = ${id}`);
      const chain = await verifyAuditChain(tx);
      expect(chain.ok).toBe(false);
      expect(chain.breaks[0]).toMatchObject({ id, reason: "hash mismatch" });
      tx.rollback();
    }).catch((e) => {
      if (!String(e).includes("Rollback")) throw e;
    });
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
});
