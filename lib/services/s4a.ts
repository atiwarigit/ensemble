import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { user } from "@/db/schema/auth";
import { s4aMetrics, spotifyArtists, spotifyTracks } from "@/db/schema/analytics";
import { importBatches, type S4aConfig } from "@/db/schema/expenses";
import { DATE_FORMATS, decodeCsv, headerSignature, MAX_IMPORT_BYTES, parseCsv } from "@/lib/csv/expenses-csv";
import {
  guessS4aConfig,
  matchTrack,
  S4A_METRICS,
  transformS4aRows,
  validateS4aConfig,
  type S4aMetric,
  type S4aRowError,
} from "@/lib/csv/s4a-csv";
import { recordAudit } from "./audit";
import { requireProjectRole } from "./access";
import { forbidden, invalid, notFound, type ServiceContext } from "./context";
import { LARGE_IMPORT_ROWS } from "./imports";

type Batch = typeof importBatches.$inferSelect;

export async function loadS4aBatch(exec: Executor, ctx: ServiceContext, batchId: string, opts: { forUpdate?: boolean } = {}) {
  const q = exec
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.workspaceId, ctx.workspaceId), eq(importBatches.kind, "s4a")));
  const [batch] = opts.forUpdate ? await q.for("update") : await q;
  if (!batch || !batch.projectId) throw notFound("Import not found.");
  const access = await requireProjectRole(exec, ctx, batch.projectId, "viewer");
  return { batch: batch as Batch & { projectId: string }, ...access };
}

async function assertCanImport(exec: Executor, ctx: ServiceContext, projectId: string) {
  const { project } = await requireProjectRole(exec, ctx, projectId, "editor");
  if (project.archivedAt) throw invalid("This project is archived.");
  return project;
}

export async function createS4aImport(ctx: ServiceContext, input: { filename: string; bytes: Uint8Array; projectId: string }) {
  if (!input.projectId) throw invalid("Choose the project this export belongs to.");
  if (input.bytes.byteLength === 0) throw invalid("The file is empty.");
  if (input.bytes.byteLength > MAX_IMPORT_BYTES) throw invalid("Files must be 10 MB or smaller.");
  const { text } = decodeCsv(input.bytes);
  const parsed = parseCsv(text);
  if (parsed.headers.length < 2) throw invalid("That doesn't look like a Spotify for Artists CSV export.");
  if (parsed.rows.length === 0) throw invalid("The file has a header row but no data.");
  const config = guessS4aConfig(parsed.headers, parsed.rows.slice(0, 50));

  return db.transaction(async (tx) => {
    await assertCanImport(tx, ctx, input.projectId);
    const [batch] = await tx
      .insert(importBatches)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: input.projectId,
        kind: "s4a",
        filename: input.filename.slice(0, 200),
        fileSha256: createHash("sha256").update(input.bytes).digest("hex"),
        rawCsv: text,
        headers: parsed.headers,
        headerSignature: headerSignature(parsed.headers),
        s4aConfig: config,
        rowCount: parsed.rows.length,
        createdBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "import.uploaded",
      projectId: input.projectId,
      entityType: "import_batch",
      entityId: batch.id,
      after: { kind: "s4a", filename: batch.filename, rows: batch.rowCount, sha256: batch.fileSha256 },
    });
    return batch;
  });
}

export type S4aPreviewPoint = {
  line: number;
  date: string;
  trackKey: string;
  trackName: string | null;
  trackId: string | null;
  metric: S4aMetric;
  value: number;
  status: "new" | "duplicate" | "changed";
  storedValue: number | null;
};

export type S4aPreview = {
  configError: string | null;
  points: S4aPreviewPoint[];
  errors: S4aRowError[];
  totals: { rows: number; points: number; toImport: number; duplicates: number; changed: number; errors: number };
  dateRange: { from: string; to: string } | null;
  metrics: S4aMetric[];
  unmatchedSongs: string[];
  tracks: { id: string; name: string }[];
};

export async function projectTracks(exec: Executor, projectId: string) {
  return exec
    .select({ id: spotifyTracks.id, spotifyTrackId: spotifyTracks.spotifyTrackId, isrc: spotifyTracks.isrc, name: spotifyTracks.name })
    .from(spotifyTracks)
    .innerJoin(spotifyArtists, eq(spotifyArtists.id, spotifyTracks.artistLinkId))
    .where(and(eq(spotifyTracks.projectId, projectId), isNull(spotifyArtists.unlinkedAt)))
    .orderBy(spotifyTracks.name);
}

async function buildS4aPreview(exec: Executor, batch: Batch & { projectId: string }, config: S4aConfig): Promise<S4aPreview> {
  const tracks = await projectTracks(exec, batch.projectId);
  const empty = (configError: string | null): S4aPreview => ({
    configError,
    points: [],
    errors: [],
    totals: { rows: batch.rowCount, points: 0, toImport: 0, duplicates: 0, changed: 0, errors: 0 },
    dateRange: null,
    metrics: [],
    unmatchedSongs: [],
    tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
  });
  if (!batch.rawCsv) return empty("The original file is no longer available for this import.");
  const parsed = parseCsv(batch.rawCsv);
  const configError = validateS4aConfig(parsed.headers, config);
  if (configError) return empty(configError);
  if (config.fixedTrackId && !tracks.some((t) => t.id === config.fixedTrackId)) return empty("That song isn't linked to this project.");

  const { points: raw, errors } = transformS4aRows(parsed.headers, parsed.rows, config);
  const unmatched = new Set<string>();
  const seen = new Set<string>();
  const points: S4aPreviewPoint[] = [];
  for (const p of raw) {
    let trackKey = "";
    let trackName: string | null = null;
    let trackId: string | null = null;
    if (config.fixedTrackId) {
      const t = tracks.find((x) => x.id === config.fixedTrackId)!;
      [trackKey, trackName, trackId] = [`t:${t.id}`, t.name, t.id];
    } else if (p.trackText) {
      const t = matchTrack(p.trackText, tracks);
      if (t) [trackKey, trackName, trackId] = [`t:${t.id}`, t.name, t.id];
      else {
        unmatched.add(p.trackText);
        [trackKey, trackName] = [`n:${p.trackText.toLowerCase()}`, p.trackText];
      }
    }
    const key = `${p.date}|${trackKey}|${p.metric}`;
    if (seen.has(key)) {
      errors.push({ line: p.line, message: `Repeats ${p.date} ${trackName ?? "artist"} ${p.metric}; the first row is used.` });
      continue;
    }
    seen.add(key);
    points.push({ line: p.line, date: p.date, trackKey, trackName, trackId, metric: p.metric, value: p.value, status: "new", storedValue: null });
  }

  const dates = points.map((p) => p.date).sort();
  const dateRange = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  if (dateRange) {
    const stored = await exec
      .select({ date: s4aMetrics.date, trackKey: s4aMetrics.trackKey, metric: s4aMetrics.metric, value: s4aMetrics.value })
      .from(s4aMetrics)
      .where(
        and(
          eq(s4aMetrics.projectId, batch.projectId),
          isNull(s4aMetrics.archivedAt),
          gte(s4aMetrics.date, dateRange.from),
          lte(s4aMetrics.date, dateRange.to),
        ),
      );
    const byKey = new Map(stored.map((s) => [`${s.date}|${s.trackKey}|${s.metric}`, s.value]));
    for (const p of points) {
      const v = byKey.get(`${p.date}|${p.trackKey}|${p.metric}`);
      if (v === undefined) continue;
      p.storedValue = v;
      p.status = v === p.value ? "duplicate" : "changed";
    }
  }

  return {
    configError: null,
    points,
    errors,
    totals: {
      rows: batch.rowCount,
      points: points.length,
      toImport: points.filter((p) => p.status === "new").length,
      duplicates: points.filter((p) => p.status === "duplicate").length,
      changed: points.filter((p) => p.status === "changed").length,
      errors: errors.length,
    },
    dateRange,
    metrics: S4A_METRICS.filter((m) => points.some((p) => p.metric === m)),
    unmatchedSongs: [...unmatched].slice(0, 50),
    tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
  };
}

export async function getS4aPreview(exec: Executor, ctx: ServiceContext, batchId: string) {
  const { batch, role } = await loadS4aBatch(exec, ctx, batchId);
  if (batch.status !== "previewed" || !batch.s4aConfig) return { batch, role, preview: null };
  return { batch, role, preview: await buildS4aPreview(exec, batch, batch.s4aConfig) };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const col = z.string().trim().nullish().transform((v) => (v && v !== "__none" ? v : null));

export const s4aConfigInput = z.object({
  dateColumn: col,
  dateFormat: z.enum(DATE_FORMATS),
  fixedDate: z.union([isoDate, z.literal("")]).nullish().transform((v) => v || null),
  trackColumn: col,
  fixedTrackId: z.union([z.string().uuid(), z.literal(""), z.literal("__none")]).nullish().transform((v) => (v && v !== "__none" ? v : null)),
  metrics: z.object(Object.fromEntries(S4A_METRICS.map((m) => [m, col])) as Record<S4aMetric, typeof col>),
});

export async function updateS4aConfig(ctx: ServiceContext, batchId: string, input: z.input<typeof s4aConfigInput>) {
  const data = s4aConfigInput.parse(input);
  const config: S4aConfig = {
    ...data,
    metrics: Object.fromEntries(Object.entries(data.metrics).filter(([, v]) => v)) as S4aConfig["metrics"],
  };
  return db.transaction(async (tx) => {
    const { batch } = await loadS4aBatch(tx, ctx, batchId, { forUpdate: true });
    if (batch.status !== "previewed") throw invalid("This import has already been committed.");
    await assertCanImport(tx, ctx, batch.projectId);
    const error = validateS4aConfig(batch.headers, config);
    if (error) throw invalid(error);
    await tx.update(importBatches).set({ s4aConfig: config }).where(eq(importBatches.id, batch.id));
  });
}

export function s4aNeedsApproval(batch: Batch) {
  return batch.rowCount > LARGE_IMPORT_ROWS;
}

export async function pendingS4aPoints(exec: Executor, ctx: ServiceContext, batch: Batch) {
  const { batch: b } = await loadS4aBatch(exec, ctx, batch.id);
  if (!b.s4aConfig) throw invalid("Map the columns before importing.");
  const preview = await buildS4aPreview(exec, b, b.s4aConfig);
  if (preview.configError) throw invalid(preview.configError);
  return preview.totals.toImport;
}

export async function commitS4aImport(ctx: ServiceContext, batchId: string) {
  return db.transaction((tx) => commitS4aImportTx(tx, ctx, batchId, { approved: false }));
}

/**
 * Inserts the new points. Points already stored are kept as they are, including ones whose value
 * differs (S4A revises recent days); the preview and the audit event list how many differed.
 */
export async function commitS4aImportTx(tx: Executor, ctx: ServiceContext, batchId: string, opts: { approved: boolean }) {
  const { batch } = await loadS4aBatch(tx, ctx, batchId, { forUpdate: true });
  if (batch.status !== "previewed") throw invalid("This import has already been committed.");
  await assertCanImport(tx, ctx, batch.projectId);
  if (!batch.s4aConfig) throw invalid("Map the columns before importing.");
  const preview = await buildS4aPreview(tx, batch, batch.s4aConfig);
  if (preview.configError) throw invalid(preview.configError);
  if (s4aNeedsApproval(batch) && !opts.approved) {
    throw forbidden(`Imports over ${LARGE_IMPORT_ROWS} rows need an approval. Request one from this page.`);
  }
  if (preview.totals.toImport === 0 && preview.totals.points === 0) throw invalid("Nothing in this file can be imported.");

  const toInsert = preview.points.filter((p) => p.status === "new");
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const result = await tx
      .insert(s4aMetrics)
      .values(
        toInsert.slice(i, i + 500).map((p) => ({
          workspaceId: ctx.workspaceId,
          projectId: batch.projectId,
          date: p.date,
          trackKey: p.trackKey,
          trackName: p.trackName,
          trackId: p.trackId,
          metric: p.metric,
          value: p.value,
          importBatchId: batch.id,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: s4aMetrics.id });
    inserted += result.length;
  }
  const skippedDupes = preview.totals.duplicates + preview.totals.changed + (toInsert.length - inserted);
  const [updated] = await tx
    .update(importBatches)
    .set({
      status: "committed",
      inserted,
      skippedDupes,
      errors: preview.errors.slice(0, 100),
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
      kind: "s4a",
      filename: batch.filename,
      sha256: batch.fileSha256,
      rows: batch.rowCount,
      inserted,
      skippedDupes,
      changedKept: preview.totals.changed,
      errors: preview.totals.errors,
      metrics: preview.metrics,
      dateRange: preview.dateRange,
      unmatchedSongs: preview.unmatchedSongs.length,
    },
  });
  return updated;
}

export async function revertS4aImportTx(tx: Executor, ctx: ServiceContext, batchId: string) {
  const { batch } = await loadS4aBatch(tx, ctx, batchId, { forUpdate: true });
  if (batch.status !== "committed") throw invalid("Only committed imports can be reverted.");
  await requireProjectRole(tx, ctx, batch.projectId, "lead");
  const removed = await tx
    .update(s4aMetrics)
    .set({ archivedAt: new Date() })
    .where(and(eq(s4aMetrics.importBatchId, batch.id), isNull(s4aMetrics.archivedAt)))
    .returning({ id: s4aMetrics.id });
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
    after: { kind: "s4a", status: "reverted", removed: removed.length },
  });
  return { removed: removed.length };
}

export async function discardS4aImport(ctx: ServiceContext, batchId: string) {
  return db.transaction(async (tx) => {
    const { batch } = await loadS4aBatch(tx, ctx, batchId, { forUpdate: true });
    if (batch.status !== "previewed") throw invalid("Committed imports can't be discarded. Revert them instead.");
    await assertCanImport(tx, ctx, batch.projectId);
    await tx.delete(importBatches).where(eq(importBatches.id, batch.id));
    await recordAudit(tx, ctx, {
      action: "import.discarded",
      projectId: batch.projectId,
      entityType: "import_batch",
      entityId: batch.id,
      before: { kind: "s4a", filename: batch.filename, rows: batch.rowCount },
    });
  });
}

export async function listS4aImports(exec: Executor, ctx: ServiceContext, projectId: string) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  return exec
    .select({ batch: importBatches, createdByName: user.name })
    .from(importBatches)
    .leftJoin(user, eq(user.id, importBatches.createdBy))
    .where(and(eq(importBatches.projectId, projectId), eq(importBatches.kind, "s4a")))
    .orderBy(desc(importBatches.createdAt))
    .limit(50);
}

// ---------------------------------------------------------------------------------------------
// Reads

export type S4aSeriesPoint = { date: string; value: number };

/** Daily values for one metric; artist-level when `trackKey` is '' (the default). */
export async function s4aSeries(
  exec: Executor,
  ctx: ServiceContext,
  projectId: string,
  f: { metric: S4aMetric; trackKey?: string; from?: string; to?: string },
) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  return exec
    .select({ date: s4aMetrics.date, value: s4aMetrics.value })
    .from(s4aMetrics)
    .where(
      and(
        eq(s4aMetrics.projectId, projectId),
        isNull(s4aMetrics.archivedAt),
        eq(s4aMetrics.metric, f.metric),
        eq(s4aMetrics.trackKey, f.trackKey ?? ""),
        f.from ? gte(s4aMetrics.date, f.from) : undefined,
        f.to ? lte(s4aMetrics.date, f.to) : undefined,
      ),
    )
    .orderBy(s4aMetrics.date);
}

/** Per-song totals over a window, e.g. for "compare tracks". */
export async function s4aTrackTotals(
  exec: Executor,
  ctx: ServiceContext,
  projectId: string,
  f: { metric: S4aMetric; from: string; to: string },
) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  return exec
    .select({
      trackKey: s4aMetrics.trackKey,
      trackName: sql<string>`max(${s4aMetrics.trackName})`,
      trackId: sql<string | null>`max(${s4aMetrics.trackId}::text)`,
      total: sql<number>`sum(${s4aMetrics.value})::bigint`.mapWith(Number),
      days: sql<number>`count(distinct ${s4aMetrics.date})`.mapWith(Number),
    })
    .from(s4aMetrics)
    .where(
      and(
        eq(s4aMetrics.projectId, projectId),
        isNull(s4aMetrics.archivedAt),
        eq(s4aMetrics.metric, f.metric),
        sql`${s4aMetrics.trackKey} <> ''`,
        gte(s4aMetrics.date, f.from),
        lte(s4aMetrics.date, f.to),
      ),
    )
    .groupBy(s4aMetrics.trackKey)
    .orderBy(sql`4 desc`);
}

/** The most recent day with S4A data for the project, per metric. */
export async function s4aCoverage(exec: Executor, ctx: ServiceContext, projectId: string) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  return exec
    .select({
      metric: s4aMetrics.metric,
      from: sql<string>`min(${s4aMetrics.date})::text`,
      to: sql<string>`max(${s4aMetrics.date})::text`,
      points: sql<number>`count(*)`.mapWith(Number),
    })
    .from(s4aMetrics)
    .where(and(eq(s4aMetrics.projectId, projectId), isNull(s4aMetrics.archivedAt)))
    .groupBy(s4aMetrics.metric);
}
