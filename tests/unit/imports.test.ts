import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { listAuditEvents } from "@/lib/services/audit";
import {
  budgetStatus,
  createExpense,
  listCategories,
  listExpenses,
  seedDefaultCategories,
  upsertBudget,
} from "@/lib/services/expenses";
import { commitImport, createImport, getImportPreview, revertImport } from "@/lib/services/imports";
import { createProject, setProjectMember } from "@/lib/services/projects";
import { createMember, createWorkspace } from "./fixtures";

const sample = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, "../../samples/bank-csv", name)));

async function setup() {
  const ws = await createWorkspace();
  await seedDefaultCategories(db, ws.id);
  const owner = await createMember(ws.id, "owner", "Romel");
  const nikki = await createMember(ws.id, "member", "Nikki");
  const project = await createProject(owner, { name: "Xania", type: "artist" });
  return { ws, owner, nikki, project };
}

describe("CSV import service", () => {
  it("imports a bank file, skips everything on re-import, and audits both", async () => {
    const { owner, project } = await setup();
    const bytes = sample("chase-checking-2026-10.csv");

    const first = await createImport(owner, { filename: "chase.csv", bytes, projectId: project.id });
    const { preview } = await getImportPreview(db, owner, first.batch.id);
    expect(preview?.mappingError).toBeNull();
    expect(preview?.totals.toImport).toBe(12);
    expect(preview?.totals.excluded).toBeGreaterThan(0);

    const committed = await commitImport(owner, first.batch.id);
    expect(committed.inserted).toBe(12);
    expect(committed.rawCsv).toBeNull();

    const listed = await listExpenses(db, owner, { projectId: project.id });
    expect(listed.count).toBe(12);
    expect(listed.rows.every((r) => r.expense.currency === "USD")).toBe(true);

    const second = await createImport(owner, { filename: "chase-again.csv", bytes, projectId: project.id });
    const again = await getImportPreview(db, owner, second.batch.id);
    expect(again.preview?.totals.toImport).toBe(0);
    expect(again.preview?.totals.duplicates).toBe(12);
    const recommitted = await commitImport(owner, second.batch.id);
    expect(recommitted.inserted).toBe(0);
    expect(recommitted.skippedDupes).toBe(12);
    expect((await listExpenses(db, owner, { projectId: project.id })).count).toBe(12);

    const actions = (await listAuditEvents(db, owner, { projectId: project.id })).map((e) => e.event.action);
    expect(actions.filter((a) => a === "import.committed")).toHaveLength(2);
  });

  it("applies categorization rules from the workspace", async () => {
    const { owner, project } = await setup();
    const cats = await listCategories(db, owner);
    const suno = cats.find((c) => c.name === "Suno")!;
    const { createRule } = await import("@/lib/services/expenses");
    await createRule(owner, { pattern: "suno", categoryId: suno.id });

    const { batch } = await createImport(owner, {
      filename: "chase.csv",
      bytes: sample("chase-checking-2026-10.csv"),
      projectId: project.id,
    });
    const { preview } = await getImportPreview(db, owner, batch.id);
    const sunoRows = preview!.rows.filter((r) => r.description.toLowerCase().includes("suno"));
    expect(sunoRows.length).toBeGreaterThan(0);
    expect(sunoRows.every((r) => r.categoryId === suno.id && r.categorySource === "rule")).toBe(true);
  });

  it("reverting archives the batch's expenses so they can be imported again", async () => {
    const { owner, project } = await setup();
    const bytes = sample("amex-gold-2026-10.csv");
    const { batch } = await createImport(owner, { filename: "amex.csv", bytes, projectId: project.id });
    const committed = await commitImport(owner, batch.id);
    expect(committed.inserted).toBeGreaterThan(0);

    const { removed } = await revertImport(owner, batch.id);
    expect(removed).toBe(committed.inserted);
    expect((await listExpenses(db, owner, { projectId: project.id })).count).toBe(0);
    await expect(revertImport(owner, batch.id)).rejects.toMatchObject({ code: "invalid" });

    const retry = await createImport(owner, { filename: "amex.csv", bytes, projectId: project.id });
    expect((await commitImport(owner, retry.batch.id)).inserted).toBe(committed.inserted);
  });

  it("only project leads can revert, and editors can import", async () => {
    const { owner, nikki, project } = await setup();
    await setProjectMember(owner, project.id, { userId: nikki.userId, role: "editor" });
    const { batch } = await createImport(nikki, {
      filename: "c1.csv",
      bytes: sample("capital-one-2026-q3.csv"),
      projectId: project.id,
    });
    await commitImport(nikki, batch.id);
    await expect(revertImport(nikki, batch.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(revertImport(owner, batch.id)).resolves.toBeTruthy();
  });

  it("hides imports into projects the caller can't see", async () => {
    const { owner, nikki, project } = await setup();
    await expect(
      createImport(nikki, { filename: "x.csv", bytes: sample("chase-checking-2026-10.csv"), projectId: project.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    const { batch } = await createImport(owner, {
      filename: "x.csv",
      bytes: sample("chase-checking-2026-10.csv"),
      projectId: project.id,
    });
    await expect(getImportPreview(db, nikki, batch.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports row-level errors for a messy file without blocking good rows", async () => {
    const { owner } = await setup();
    const { batch } = await createImport(owner, {
      filename: "messy.csv",
      bytes: sample("messy-semicolon-latin1.csv"),
      projectId: null,
    });
    const { preview } = await getImportPreview(db, owner, batch.id);
    expect(preview?.mappingError).toBeNull();
    expect(preview?.totals.errors).toBe(3);
    expect(preview?.totals.toImport).toBeGreaterThan(0);
  });
});

describe("expense visibility and budgets", () => {
  it("personal expenses are visible to their creator and owners only", async () => {
    const ws = await createWorkspace();
    const owner = await createMember(ws.id, "owner", "Romel");
    const nikki = await createMember(ws.id, "member", "Nikki");
    const other = await createMember(ws.id, "member", "Other");
    await createExpense(nikki, { date: "2026-10-03", amount: "24.00", description: "Suno Pro" });

    expect((await listExpenses(db, nikki)).count).toBe(1);
    expect((await listExpenses(db, owner)).count).toBe(1);
    expect((await listExpenses(db, other)).count).toBe(0);
  });

  it("flags budgets that cross their alert threshold", async () => {
    const { owner, project } = await setup();
    await upsertBudget(owner, { projectId: project.id, period: "month", amount: "100.00", alertAtPct: 80 });
    await createExpense(owner, { date: "2026-10-05", amount: "85.00", description: "Meta ads", projectId: project.id });

    const [status] = await budgetStatus(db, owner, { projectId: project.id, month: "2026-10" });
    expect(status).toMatchObject({ spentMinor: 8500, pct: 85, state: "warning" });

    await createExpense(owner, { date: "2026-10-06", amount: "20.00", description: "Kling", projectId: project.id });
    const [over] = await budgetStatus(db, owner, { projectId: project.id, month: "2026-10" });
    expect(over.state).toBe("over");
  });
});
