import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { user } from "@/db/schema/auth";
import { expenses, importBatches, importMappings, type ColumnMap } from "@/db/schema/expenses";
import { projects } from "@/db/schema/tenancy";
import {
  DATE_FORMATS,
  decodeCsv,
  dedupeHash,
  guessMapping,
  headerSignature,
  MAX_IMPORT_BYTES,
  parseCsv,
  transformRows,
  validateMapping,
  type DateFormat,
  type MappingConfig,
  type TransformedRow,
} from "@/lib/csv/expenses-csv";
import { recordAudit } from "./audit";
import { requireProjectRole, requireWorkspaceRole, visibleProjectIds } from "./access";
import { forbidden, invalid, notFound, type ServiceContext } from "./context";
import { listCategories, listRules, matchRule } from "./expenses";

/** Plan §3.5: commits above this many rows, and every revert, run only through an approval request. */
export const LARGE_IMPORT_ROWS = 500;
const INSERT_CHUNK = 500;

export type ImportBatch = typeof importBatches.$inferSelect;

export async function loadBatch(exec: Executor, ctx: ServiceContext, batchId: string, opts: { forUpdate?: boolean } = {}) {
  const q = exec
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.workspaceId, ctx.workspaceId)));
  const [batch] = opts.forUpdate ? await q.for("update") : await q;
  if (!batch) throw notFound("Import not found.");
  if (batch.projectId) {
    await requireProjectRole(exec, ctx, batch.projectId, "viewer");
  } else if (batch.createdBy !== ctx.userId && ctx.workspaceRole !== "owner") {
    throw notFound("Import not found.");
  }
  return batch;
}

export async function assertCanImportInto(exec: Executor, ctx: ServiceContext, projectId: string | null) {
  requireWorkspaceRole(ctx, "member");
  if (projectId) await requireProjectRole(exec, ctx, projectId, "editor");
}

// ---------------------------------------------------------------------------------------------
// Upload → preview

export async function createImport(
  ctx: ServiceContext,
  input: { filename: string; bytes: Uint8Array; projectId: string | null },
) {
  if (input.bytes.byteLength === 0) throw invalid("The file is empty.");
  if (input.bytes.byteLength > MAX_IMPORT_BYTES) throw invalid("Files must be 10 MB or smaller.");
  const { text } = decodeCsv(input.bytes);
  const parsed = parseCsv(text);
  if (parsed.headers.length < 2) throw invalid("That doesn't look like a CSV with a header row.");
  if (parsed.rows.length === 0) throw invalid("The file has a header row but no transactions.");

  const signature = headerSignature(parsed.headers);
  return db.transaction(async (tx) => {
    await assertCanImportInto(tx, ctx, input.projectId);
    const [preset] = await tx
      .select()
      .from(importMappings)
      .where(and(eq(importMappings.workspaceId, ctx.workspaceId), eq(importMappings.headerSignature, signature)))
      .orderBy(desc(importMappings.updatedAt))
      .limit(1);
    const guessed = guessMapping(parsed.headers, parsed.rows.slice(0, 50));
    const columnMap = (preset?.columnMap ?? guessed.columnMap) as ColumnMap;

    const [batch] = await tx
      .insert(importBatches)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        filename: input.filename.slice(0, 200),
        fileSha256: createHash("sha256").update(input.bytes).digest("hex"),
        rawCsv: text,
        headers: parsed.headers,
        headerSignature: signature,
        mappingId: preset?.id ?? null,
        columnMap,
        dateFormat: preset?.dateFormat ?? guessed.dateFormat,
        amountMode: preset?.amountMode ?? guessed.amountMode,
        rowCount: parsed.rows.length,
        createdBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "import.uploaded",
      projectId: input.projectId,
      entityType: "import_batch",
      entityId: batch.id,
      after: { filename: batch.filename, rows: batch.rowCount, sha256: batch.fileSha256, preset: preset?.name ?? null },
    });
    return { batch, presetName: preset?.name ?? null };
  });
}

export type PreviewRow = TransformedRow & {
  dedupeHash: string | null;
  duplicate: boolean;
  categoryId: string | null;
  categorySource: "rule" | "file" | null;
};

export type PreviewTotals = {
  rows: number;
  toImport: number;
  duplicates: number;
  excluded: number;
  errors: number;
  totalMinor: number;
};

function batchMapping(batch: ImportBatch): MappingConfig | null {
  if (!batch.columnMap || !batch.dateFormat || !batch.amountMode) return null;
  return { columnMap: batch.columnMap, dateFormat: batch.dateFormat as DateFormat, amountMode: batch.amountMode };
}

async function buildPreview(exec: Executor, ctx: ServiceContext, batch: ImportBatch, mapping: MappingConfig) {
  if (!batch.rawCsv) throw invalid("The original file is no longer available for this import.");
  const parsed = parseCsv(batch.rawCsv);
  const mappingError = validateMapping(parsed.headers, mapping);
  if (mappingError) return { mappingError, rows: [] as PreviewRow[], totals: emptyTotals(parsed.rows.length) };

  const transformed = transformRows(parsed.headers, parsed.rows, mapping);
  const [rules, categories] = await Promise.all([listRules(exec, ctx), listCategories(exec, ctx)]);
  const catByName = new Map<string, string>();
  for (const c of categories) {
    catByName.set(c.fullName.toLowerCase(), c.id);
    if (!catByName.has(c.name.toLowerCase())) catByName.set(c.name.toLowerCase(), c.id);
  }

  const rows: PreviewRow[] = transformed.map((r) => {
    const hash =
      r.status === "ok" && r.date && r.amountMinor !== null
        ? dedupeHash({
            workspaceId: ctx.workspaceId,
            date: r.date,
            amountMinor: r.amountMinor,
            description: r.description,
            accountLast4: r.account,
            occurrence: r.occurrence,
          })
        : null;
    const rule = matchRule(rules, r);
    const fileCat = r.categoryText ? (catByName.get(r.categoryText.toLowerCase()) ?? null) : null;
    return {
      ...r,
      dedupeHash: hash,
      duplicate: false,
      categoryId: rule?.categoryId ?? fileCat,
      categorySource: rule ? "rule" : fileCat ? "file" : null,
    };
  });

  const hashes = rows.map((r) => r.dedupeHash).filter((h): h is string => !!h);
  const existing = new Set<string>();
  for (let i = 0; i < hashes.length; i += 1000) {
    const found = await exec
      .select({ hash: expenses.dedupeHash })
      .from(expenses)
      .where(
        and(
          eq(expenses.workspaceId, ctx.workspaceId),
          isNull(expenses.archivedAt),
          inArray(expenses.dedupeHash, hashes.slice(i, i + 1000)),
        ),
      );
    found.forEach((f) => f.hash && existing.add(f.hash));
  }
  for (const r of rows) if (r.dedupeHash && existing.has(r.dedupeHash)) r.duplicate = true;

  const importable = rows.filter((r) => r.status === "ok" && !r.duplicate);
  const totals: PreviewTotals = {
    rows: rows.length,
    toImport: importable.length,
    duplicates: rows.filter((r) => r.duplicate).length,
    excluded: rows.filter((r) => r.status === "credit" || r.status === "transfer").length,
    errors: rows.filter((r) => r.status === "error").length,
    totalMinor: importable.reduce((s, r) => s + (r.amountMinor ?? 0), 0),
  };
  return { mappingError: null, rows, totals };
}

function emptyTotals(rows: number): PreviewTotals {
  return { rows, toImport: 0, duplicates: 0, excluded: 0, errors: 0, totalMinor: 0 };
}

export async function getImportPreview(exec: Executor, ctx: ServiceContext, batchId: string) {
  const batch = await loadBatch(exec, ctx, batchId);
  const mapping = batchMapping(batch);
  if (batch.status !== "previewed" || !mapping) return { batch, mapping, preview: null };
  const preview = await buildPreview(exec, ctx, batch, mapping);
  return { batch, mapping, preview };
}

export const mappingInput = z.object({
  columnMap: z.object({
    date: z.string().min(1, "Choose the date column"),
    description: z.string().min(1, "Choose the description column"),
    amount: z.string().nullish(),
    debit: z.string().nullish(),
    credit: z.string().nullish(),
    merchant: z.string().nullish(),
    category: z.string().nullish(),
    account: z.string().nullish(),
    currency: z.string().nullish(),
  }),
  amountMode: z.enum(["negative_is_expense", "positive_is_expense", "split"]),
  dateFormat: z.enum(DATE_FORMATS),
  saveAs: z.string().trim().max(60).optional(),
});

export async function updateImportMapping(ctx: ServiceContext, batchId: string, input: z.input<typeof mappingInput>) {
  const data = mappingInput.parse(input);
  const clean = Object.fromEntries(
    Object.entries(data.columnMap).map(([k, v]) => [k, v && v !== "__none" ? v : null]),
  ) as ColumnMap;
  return db.transaction(async (tx) => {
    const batch = await loadBatch(tx, ctx, batchId, { forUpdate: true });
    if (batch.status !== "previewed") throw invalid("This import has already been committed.");
    await assertCanImportInto(tx, ctx, batch.projectId);
    const error = validateMapping(batch.headers, { columnMap: clean, amountMode: data.amountMode, dateFormat: data.dateFormat });
    if (error) throw invalid(error);

    let mappingId = batch.mappingId;
    if (data.saveAs) {
      const [preset] = await tx
        .insert(importMappings)
        .values({
          workspaceId: ctx.workspaceId,
          name: data.saveAs,
          columnMap: clean,
          dateFormat: data.dateFormat,
          amountMode: data.amountMode,
          headerSignature: batch.headerSignature,
          createdBy: ctx.userId,
        })
        .returning();
      mappingId = preset.id;
      await recordAudit(tx, ctx, {
        action: "import.mapping.saved",
        entityType: "import_mapping",
        entityId: preset.id,
        after: { name: data.saveAs, columnMap: clean, dateFormat: data.dateFormat, amountMode: data.amountMode },
      });
    }
    await tx
      .update(importBatches)
      .set({ columnMap: clean, amountMode: data.amountMode, dateFormat: data.dateFormat, mappingId })
      .where(eq(importBatches.id, batchId));
  });
}

// ---------------------------------------------------------------------------------------------
// Commit / revert / discard

export async function commitImport(ctx: ServiceContext, batchId: string) {
  return db.transaction((tx) => commitImportTx(tx, ctx, batchId, { approved: false }));
}

/** Rows a commit would insert right now; used to decide whether the commit needs an approval. */
export async function pendingImportRows(exec: Executor, ctx: ServiceContext, batch: ImportBatch) {
  const mapping = batchMapping(batch);
  if (!mapping) throw invalid("Map the columns before importing.");
  const { mappingError, totals } = await buildPreview(exec, ctx, batch, mapping);
  if (mappingError) throw invalid(mappingError);
  return totals.toImport;
}

/** `approved` is set only by the approvals service when executing an approved request. */
export async function commitImportTx(tx: Executor, ctx: ServiceContext, batchId: string, opts: { approved: boolean }) {
  const batch = await loadBatch(tx, ctx, batchId, { forUpdate: true });
  if (batch.status !== "previewed") throw invalid("This import has already been committed.");
  await assertCanImportInto(tx, ctx, batch.projectId);
  const mapping = batchMapping(batch);
  if (!mapping) throw invalid("Map the columns before importing.");
  const { mappingError, rows, totals } = await buildPreview(tx, ctx, batch, mapping);
  if (mappingError) throw invalid(mappingError);
  if (totals.toImport > LARGE_IMPORT_ROWS && !opts.approved) {
    throw forbidden(`Imports over ${LARGE_IMPORT_ROWS} rows need an approval. Request one from this page.`);
  }

  const toInsert = rows.filter((r) => r.status === "ok" && !r.duplicate);
  let inserted = 0;
  let insertedMinor = 0;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK);
    const result = await tx
      .insert(expenses)
      .values(
        chunk.map((r) => ({
          workspaceId: ctx.workspaceId,
          projectId: batch.projectId,
          date: r.date!,
          amountMinor: r.amountMinor!,
          currency: r.currency,
          merchant: r.merchant,
          description: r.description,
          categoryId: r.categoryId,
          paymentAccount: r.account,
          source: "csv" as const,
          importBatchId: batch.id,
          dedupeHash: r.dedupeHash,
          createdBy: ctx.userId,
        })),
      )
      .onConflictDoNothing()
      .returning({ amountMinor: expenses.amountMinor });
    inserted += result.length;
    insertedMinor += result.reduce((s, r) => s + r.amountMinor, 0);
  }

  const errors = rows
    .filter((r) => r.status === "error")
    .slice(0, 100)
    .map((r) => ({ line: r.line, message: r.errors.join("; ") }));
  const skippedDupes = totals.duplicates + (toInsert.length - inserted);
  const [updated] = await tx
    .update(importBatches)
    .set({
      status: "committed",
      inserted,
      skippedDupes,
      excluded: totals.excluded,
      errors,
      totalMinor: insertedMinor,
      rawCsv: null,
      committedAt: new Date(),
    })
    .where(eq(importBatches.id, batch.id))
    .returning();
  await recordAudit(tx, ctx, {
    action: "import.committed",
    projectId: batch.projectId,
    entityType: "import_batch",
    entityId: batch.id,
    after: {
      filename: batch.filename,
      sha256: batch.fileSha256,
      rows: totals.rows,
      inserted,
      skippedDupes,
      excluded: totals.excluded,
      errors: totals.errors,
      totalMinor: insertedMinor,
      currency: "USD",
    },
  });
  return updated;
}

/** Reverts are always gated (plan §3.5); this runs only when an approved request executes. */
export async function revertImportTx(tx: Executor, ctx: ServiceContext, batchId: string) {
  const batch = await loadBatch(tx, ctx, batchId, { forUpdate: true });
  if (batch.status !== "committed") throw invalid("Only committed imports can be reverted.");
  if (batch.projectId) await requireProjectRole(tx, ctx, batch.projectId, "lead");
  else if (batch.createdBy !== ctx.userId && ctx.workspaceRole !== "owner") throw forbidden();

  const removed = await tx
    .update(expenses)
    .set({ archivedAt: new Date() })
    .where(and(eq(expenses.importBatchId, batch.id), isNull(expenses.archivedAt)))
    .returning({ id: expenses.id });
  await tx
    .update(importBatches)
    .set({ status: "reverted", revertedAt: new Date(), revertedBy: ctx.userId })
    .where(eq(importBatches.id, batch.id));
  await recordAudit(tx, ctx, {
    action: "import.reverted",
    projectId: batch.projectId,
    entityType: "import_batch",
    entityId: batch.id,
    before: { status: "committed", inserted: batch.inserted },
    after: { status: "reverted", removed: removed.length },
  });
  return { removed: removed.length };
}

export async function discardImport(ctx: ServiceContext, batchId: string) {
  return db.transaction(async (tx) => {
    const batch = await loadBatch(tx, ctx, batchId, { forUpdate: true });
    if (batch.status !== "previewed") throw invalid("Committed imports can't be discarded. Revert them instead.");
    await tx.delete(importBatches).where(eq(importBatches.id, batch.id));
    await recordAudit(tx, ctx, {
      action: "import.discarded",
      projectId: batch.projectId,
      entityType: "import_batch",
      entityId: batch.id,
      before: { filename: batch.filename, rows: batch.rowCount },
    });
  });
}

export async function listImportBatches(exec: Executor, ctx: ServiceContext) {
  const conds = [eq(importBatches.workspaceId, ctx.workspaceId)];
  if (ctx.workspaceRole !== "owner") {
    const ids = await visibleProjectIds(exec, ctx, { includeArchived: true });
    conds.push(
      or(
        ids.length ? inArray(importBatches.projectId, ids) : sql`false`,
        and(isNull(importBatches.projectId), eq(importBatches.createdBy, ctx.userId)),
      )!,
    );
  }
  return exec
    .select({
      id: importBatches.id,
      filename: importBatches.filename,
      status: importBatches.status,
      rowCount: importBatches.rowCount,
      inserted: importBatches.inserted,
      skippedDupes: importBatches.skippedDupes,
      excluded: importBatches.excluded,
      totalMinor: importBatches.totalMinor,
      createdAt: importBatches.createdAt,
      committedAt: importBatches.committedAt,
      revertedAt: importBatches.revertedAt,
      projectId: importBatches.projectId,
      projectName: projects.name,
      createdByName: user.name,
    })
    .from(importBatches)
    .leftJoin(projects, eq(projects.id, importBatches.projectId))
    .leftJoin(user, eq(user.id, importBatches.createdBy))
    .where(and(...conds))
    .orderBy(desc(importBatches.createdAt))
    .limit(100);
}

export async function listMappingPresets(exec: Executor, ctx: ServiceContext) {
  return exec
    .select({ id: importMappings.id, name: importMappings.name, createdAt: importMappings.createdAt })
    .from(importMappings)
    .where(eq(importMappings.workspaceId, ctx.workspaceId))
    .orderBy(desc(importMappings.updatedAt));
}
