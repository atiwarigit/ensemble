import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { user } from "@/db/schema/auth";
import {
  generationLinks,
  lyricContributors,
  lyricEvidence,
  lyricVersions,
  lyricWorks,
  type LyricWorkStatus,
} from "@/db/schema/lyrics";
import { projects } from "@/db/schema/tenancy";
import { recordAudit } from "./audit";
import { requireProjectRole, visibleProjectIds } from "./access";
import { forbidden, invalid, notFound, type ServiceContext } from "./context";
import { readFile, sha256Hex, storeFile } from "./files";

export const MAX_LYRIC_CHARS = 50_000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

const pastDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2019-06-01")
  .refine((d) => d <= new Date().toISOString().slice(0, 10), "The date can't be in the future")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null))
  .transform((v) => v || null);

/** Line endings are normalised so the same text always hashes the same. */
const lyricBody = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim())
  .pipe(z.string().min(1, "Enter the lyrics").max(MAX_LYRIC_CHARS, "Lyrics are limited to 50,000 characters"));

export type Work = typeof lyricWorks.$inferSelect;
export type Version = typeof lyricVersions.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Works

async function loadWork(exec: Executor, ctx: ServiceContext, workId: string, opts: { forUpdate?: boolean } = {}) {
  const q = exec
    .select()
    .from(lyricWorks)
    .where(and(eq(lyricWorks.id, workId), eq(lyricWorks.workspaceId, ctx.workspaceId), isNull(lyricWorks.archivedAt)));
  const [work] = opts.forUpdate ? await q.for("update") : await q;
  if (!work) throw notFound("Lyric not found.");
  return work;
}

/** Loads a work the caller can at least view, plus their role on its project. */
export async function getWork(exec: Executor, ctx: ServiceContext, workId: string) {
  const work = await loadWork(exec, ctx, workId);
  const { project, role } = await requireProjectRole(exec, ctx, work.projectId, "viewer");
  return { work, project, role };
}

async function requireWorkRole(
  exec: Executor,
  ctx: ServiceContext,
  workId: string,
  minRole: "editor" | "lead",
  opts: { forUpdate?: boolean } = {},
) {
  const work = await loadWork(exec, ctx, workId, opts);
  const { project, role } = await requireProjectRole(exec, ctx, work.projectId, minRole);
  return { work, project, role };
}

function assertDraft(work: Work, what: string) {
  if (work.status !== "draft") {
    throw invalid(`This work is ${work.status}, so ${what} is locked. Changes after finalizing need an approval.`);
  }
}

export async function listWorks(exec: Executor, ctx: ServiceContext, f: { projectId?: string; q?: string } = {}) {
  const ids = await visibleProjectIds(exec, ctx, { includeArchived: true });
  const scoped = f.projectId ? ids.filter((id) => id === f.projectId) : ids;
  if (!scoped.length) return [];
  const latest = sql<number | null>`(select max(v.version_no) from ${lyricVersions} v where v.work_id = ${lyricWorks.id})`;
  const lastRecorded = sql<Date | null>`(select max(v.recorded_at) from ${lyricVersions} v where v.work_id = ${lyricWorks.id})`;
  const evidence = sql<number>`(select count(*)::int from ${lyricEvidence} e where e.work_id = ${lyricWorks.id})`;
  const generations = sql<number>`(select count(*)::int from ${generationLinks} g where g.work_id = ${lyricWorks.id})`;
  return exec
    .select({
      id: lyricWorks.id,
      title: lyricWorks.title,
      status: lyricWorks.status,
      projectId: lyricWorks.projectId,
      projectName: projects.name,
      authorName: user.name,
      latestVersion: latest,
      lastRecordedAt: lastRecorded,
      evidenceCount: evidence,
      generationCount: generations,
      createdAt: lyricWorks.createdAt,
    })
    .from(lyricWorks)
    .innerJoin(projects, eq(projects.id, lyricWorks.projectId))
    .leftJoin(user, eq(user.id, lyricWorks.primaryAuthorUserId))
    .where(
      and(
        eq(lyricWorks.workspaceId, ctx.workspaceId),
        inArray(lyricWorks.projectId, scoped),
        isNull(lyricWorks.archivedAt),
        f.q ? sql`${lyricWorks.title} ilike ${`%${f.q.replace(/[%_]/g, (c) => `\\${c}`)}%`}` : undefined,
      ),
    )
    .orderBy(desc(lyricWorks.updatedAt));
}

export const createWorkInput = z.object({
  projectId: z.string().uuid("Choose a project"),
  title: z.string().trim().min(1, "Give the work a title").max(200),
  body: z.string().optional().default(""),
  origin: z.enum(["human", "imported_original"]).default("human"),
  claimedWrittenAt: pastDate,
  changeNote: optionalText(500),
});

/** Creates a work and, when lyrics are given, its first version. The creator is the 100% lyricist. */
export async function createWork(ctx: ServiceContext, input: z.input<typeof createWorkInput>) {
  const data = createWorkInput.parse(input);
  const body = data.body.trim() ? lyricBody.parse(data.body) : null;
  if (data.origin === "imported_original" && !body) throw invalid("Paste the original text you're importing.");
  return db.transaction(async (tx) => {
    await requireProjectRole(tx, ctx, data.projectId, "editor");
    const [me] = await tx.select({ name: user.name }).from(user).where(eq(user.id, ctx.userId));
    const [work] = await tx
      .insert(lyricWorks)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: data.projectId,
        title: data.title,
        primaryAuthorUserId: ctx.userId,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.insert(lyricContributors).values({
      workId: work.id,
      name: me?.name ?? "Author",
      userId: ctx.userId,
      role: "lyricist",
      shareBps: 10_000,
      human: true,
    });
    await recordAudit(tx, ctx, {
      action: "lyric.work.created",
      projectId: work.projectId,
      entityType: "lyric_work",
      entityId: work.id,
      after: { title: work.title, primaryAuthor: ctx.userId, contributors: [{ name: me?.name, role: "lyricist", sharePct: 100, human: true }] },
    });
    const version = body
      ? await insertVersion(tx, ctx, work, null, {
          body,
          origin: data.origin,
          claimedWrittenAt: data.claimedWrittenAt,
          changeNote: data.changeNote ?? (data.origin === "imported_original" ? "Original text entered" : "First draft"),
        })
      : null;
    return { work, version };
  });
}

export const updateWorkInput = z.object({
  title: z.string().trim().min(1, "Give the work a title").max(200),
  isrc: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/-/g, ""))
    .pipe(z.string().regex(/^([A-Z]{2}[A-Z0-9]{3}\d{7})?$/, "ISRC looks like USRC17607839"))
    .optional()
    .transform((v) => v || null),
  iswc: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/[-.\s]/g, ""))
    .pipe(z.string().regex(/^(T\d{10})?$/, "ISWC looks like T-034.524.680-1"))
    .optional()
    .transform((v) => v || null),
});

export async function updateWork(ctx: ServiceContext, workId: string, input: z.input<typeof updateWorkInput>) {
  const data = updateWorkInput.parse(input);
  return db.transaction(async (tx) => {
    const { work } = await requireWorkRole(tx, ctx, workId, "editor", { forUpdate: true });
    if (work.status !== "draft" && data.title !== work.title) throw invalid("A final work's title can't change.");
    const [updated] = await tx.update(lyricWorks).set(data).where(eq(lyricWorks.id, workId)).returning();
    await recordAudit(tx, ctx, {
      action: "lyric.work.updated",
      projectId: work.projectId,
      entityType: "lyric_work",
      entityId: work.id,
      before: { title: work.title, isrc: work.isrc, iswc: work.iswc },
      after: data,
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------------------------
// Versions

async function insertVersion(
  exec: Executor,
  ctx: ServiceContext,
  work: Work,
  parent: Version | null,
  v: { body: string; origin: Version["origin"]; claimedWrittenAt: string | null; changeNote: string | null },
) {
  const [version] = await exec
    .insert(lyricVersions)
    .values({
      workId: work.id,
      versionNo: (parent?.versionNo ?? 0) + 1,
      body: v.body,
      // Recomputed by the insert trigger; set here only so the column is never null.
      contentSha256: sha256Hex(v.body),
      parentVersionId: parent?.id ?? null,
      origin: v.origin,
      authoredBy: ctx.userId,
      claimedWrittenAt: v.claimedWrittenAt,
      changeNote: v.changeNote,
    })
    .returning();
  await exec.update(lyricWorks).set({ updatedAt: new Date() }).where(eq(lyricWorks.id, work.id));
  const audit = await recordAudit(exec, ctx, {
    action: "lyric.version.created",
    projectId: work.projectId,
    entityType: "lyric_version",
    entityId: version.id,
    after: {
      workId: work.id,
      versionNo: version.versionNo,
      contentSha256: version.contentSha256,
      recordedAt: version.recordedAt.toISOString(),
      origin: version.origin,
      claimedWrittenAt: version.claimedWrittenAt,
      parentVersionId: version.parentVersionId,
      changeNote: version.changeNote,
    },
  });
  return { ...version, auditEventId: audit.id };
}

export const versionInput = z.object({
  body: z.string(),
  changeNote: optionalText(500),
  claimedWrittenAt: pastDate,
  /** Guards against two people saving over each other. */
  baseVersionNo: z.coerce.number().int().min(0),
});

export async function addVersion(ctx: ServiceContext, workId: string, input: z.input<typeof versionInput>) {
  const data = versionInput.parse(input);
  const body = lyricBody.parse(data.body);
  return db.transaction(async (tx) => {
    const { work } = await requireWorkRole(tx, ctx, workId, "editor", { forUpdate: true });
    assertDraft(work, "the text");
    const [latest] = await tx
      .select()
      .from(lyricVersions)
      .where(eq(lyricVersions.workId, workId))
      .orderBy(desc(lyricVersions.versionNo))
      .limit(1);
    if ((latest?.versionNo ?? 0) !== data.baseVersionNo) {
      throw invalid(`Someone saved version ${latest?.versionNo} while you were editing. Reload to see it, then reapply your changes.`);
    }
    if (latest && sha256Hex(body) === latest.contentSha256) throw invalid("Nothing changed since the last version.");
    return insertVersion(tx, ctx, work, latest ?? null, {
      body,
      origin: "human",
      claimedWrittenAt: latest ? null : data.claimedWrittenAt,
      changeNote: data.changeNote,
    });
  });
}

export async function listVersions(exec: Executor, ctx: ServiceContext, workId: string) {
  await getWork(exec, ctx, workId);
  return exec
    .select({ version: lyricVersions, authorName: user.name })
    .from(lyricVersions)
    .leftJoin(user, eq(user.id, lyricVersions.authoredBy))
    .where(eq(lyricVersions.workId, workId))
    .orderBy(desc(lyricVersions.versionNo));
}

// ---------------------------------------------------------------------------------------------
// Contributors

export const contributorsInput = z
  .array(
    z.object({
      name: z.string().trim().min(1, "Every contributor needs a name").max(120),
      userId: z.string().nullish().transform((v) => v || null),
      role: z.enum(["lyricist", "co-writer", "editor"]),
      sharePct: z.coerce.number().min(0, "Shares can't be negative").max(100),
      human: z.boolean().default(true),
    }),
  )
  .min(1, "Add at least one contributor")
  .max(20)
  .superRefine((rows, c) => {
    const total = rows.reduce((s, r) => s + Math.round(r.sharePct * 100), 0);
    if (total !== 10_000) c.addIssue({ code: "custom", message: `Shares must add up to 100% (they add up to ${total / 100}%).` });
    if (!rows.some((r) => r.human && r.role === "lyricist")) {
      c.addIssue({ code: "custom", message: "At least one human lyricist is required." });
    }
    const names = rows.map((r) => r.name.toLowerCase());
    if (new Set(names).size !== names.length) c.addIssue({ code: "custom", message: "Each contributor can only be listed once." });
  });

export type ContributorsInput = z.input<typeof contributorsInput>;

export async function listContributors(exec: Executor, workId: string) {
  return exec
    .select()
    .from(lyricContributors)
    .where(eq(lyricContributors.workId, workId))
    .orderBy(asc(lyricContributors.position), asc(lyricContributors.createdAt));
}

/** Replaces the full contributor list. Draft works only; final works go through approvals. */
export async function setContributors(ctx: ServiceContext, workId: string, input: ContributorsInput) {
  const rows = contributorsInput.parse(input);
  return db.transaction(async (tx) => {
    const { work } = await requireWorkRole(tx, ctx, workId, "editor", { forUpdate: true });
    assertDraft(work, "the split");
    return replaceContributors(tx, ctx, work, rows);
  });
}

export async function replaceContributors(
  exec: Executor,
  ctx: ServiceContext,
  work: Work,
  rows: z.output<typeof contributorsInput>,
) {
  const before = await listContributors(exec, work.id);
  await exec.delete(lyricContributors).where(eq(lyricContributors.workId, work.id));
  await exec.insert(lyricContributors).values(
    rows.map((r, i) => ({
      workId: work.id,
      name: r.name,
      userId: r.userId,
      role: r.role,
      shareBps: Math.round(r.sharePct * 100),
      human: r.human,
      position: i,
    })),
  );
  await recordAudit(exec, ctx, {
    action: "lyric.contributors.updated",
    projectId: work.projectId,
    entityType: "lyric_work",
    entityId: work.id,
    before: before.map(summarizeContributor),
    after: rows.map((r) => ({ name: r.name, userId: r.userId, role: r.role, sharePct: r.sharePct, human: r.human })),
  });
}

function summarizeContributor(c: typeof lyricContributors.$inferSelect) {
  return { name: c.name, userId: c.userId, role: c.role, sharePct: c.shareBps / 100, human: c.human };
}

// ---------------------------------------------------------------------------------------------
// Evidence

export const EVIDENCE_KINDS = {
  notebook_scan: "Notebook scan / photo",
  voice_memo: "Voice memo",
  doc: "Document",
  email: "Email",
} as const;

export const evidenceInput = z.object({
  kind: z.enum(["notebook_scan", "voice_memo", "doc", "email"]),
  versionId: z.string().uuid().nullish().or(z.literal("").transform(() => null)),
  description: optionalText(500),
});

export async function addEvidence(
  ctx: ServiceContext,
  workId: string,
  input: z.input<typeof evidenceInput> & { filename: string; contentType: string; bytes: Uint8Array },
) {
  const data = evidenceInput.parse(input);
  return db.transaction(async (tx) => {
    const { work } = await requireWorkRole(tx, ctx, workId, "editor");
    if (data.versionId) await requireVersionOfWork(tx, work.id, data.versionId);
    const file = await storeFile(tx, ctx, input);
    const [evidence] = await tx
      .insert(lyricEvidence)
      .values({
        workId: work.id,
        versionId: data.versionId ?? null,
        kind: data.kind,
        fileId: file.id,
        filename: file.filename,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        description: data.description,
        uploadedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "lyric.evidence.added",
      projectId: work.projectId,
      entityType: "lyric_evidence",
      entityId: evidence.id,
      after: {
        workId: work.id,
        versionId: evidence.versionId,
        kind: evidence.kind,
        filename: evidence.filename,
        sizeBytes: evidence.sizeBytes,
        sha256: evidence.sha256,
      },
    });
    return evidence;
  });
}

export async function listEvidence(exec: Executor, workId: string) {
  return exec
    .select({ evidence: lyricEvidence, uploadedByName: user.name, versionNo: lyricVersions.versionNo })
    .from(lyricEvidence)
    .leftJoin(user, eq(user.id, lyricEvidence.uploadedBy))
    .leftJoin(lyricVersions, eq(lyricVersions.id, lyricEvidence.versionId))
    .where(eq(lyricEvidence.workId, workId))
    .orderBy(desc(lyricEvidence.uploadedAt));
}

export async function downloadEvidence(ctx: ServiceContext, evidenceId: string) {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(lyricEvidence).where(eq(lyricEvidence.id, evidenceId));
    if (!ev) throw notFound("Evidence not found.");
    const { work } = await getWork(tx, ctx, ev.workId);
    const file = await readFile(tx, ctx, ev.fileId);
    await recordAudit(tx, ctx, {
      action: "lyric.evidence.downloaded",
      projectId: work.projectId,
      entityType: "lyric_evidence",
      entityId: ev.id,
      after: { sha256: ev.sha256 },
    });
    return { evidence: ev, data: file.data };
  });
}

// ---------------------------------------------------------------------------------------------
// Generation log

async function requireVersionOfWork(exec: Executor, workId: string, versionId: string) {
  const [v] = await exec
    .select()
    .from(lyricVersions)
    .where(and(eq(lyricVersions.id, versionId), eq(lyricVersions.workId, workId)));
  if (!v) throw invalid("That version doesn't belong to this work.");
  return v;
}

export const generationInput = z.object({
  versionId: z.string().nullish().transform((v) => v || null),
  tool: z.string().trim().min(1, "Which tool made it? e.g. Suno").max(60),
  externalRef: optionalText(300),
  notes: optionalText(1000),
});

/**
 * PRD rule: human lyrics are logged before any generation. A generation must reference a recorded
 * lyric version of this work, so a work with no lyrics can't have generations.
 */
export async function logGeneration(ctx: ServiceContext, workId: string, input: z.input<typeof generationInput>) {
  const data = generationInput.parse(input);
  return db.transaction(async (tx) => {
    const { work } = await requireWorkRole(tx, ctx, workId, "editor");
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(lyricVersions)
      .where(eq(lyricVersions.workId, work.id));
    if (count === 0) {
      throw forbidden("Log the human-written lyrics first. A generation must point at a recorded lyric version.");
    }
    if (!data.versionId) throw invalid("Choose the lyric version this generation used.");
    const version = await requireVersionOfWork(tx, work.id, data.versionId);
    const [link] = await tx
      .insert(generationLinks)
      .values({
        workId: work.id,
        versionId: version.id,
        tool: data.tool,
        externalRef: data.externalRef,
        notes: data.notes,
        loggedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "lyric.generation.logged",
      projectId: work.projectId,
      entityType: "generation_link",
      entityId: link.id,
      after: {
        workId: work.id,
        versionId: version.id,
        versionNo: version.versionNo,
        contentSha256: version.contentSha256,
        tool: link.tool,
        externalRef: link.externalRef,
      },
    });
    return link;
  });
}

export async function listGenerations(exec: Executor, workId: string) {
  return exec
    .select({ link: generationLinks, versionNo: lyricVersions.versionNo, loggedByName: user.name })
    .from(generationLinks)
    .innerJoin(lyricVersions, eq(lyricVersions.id, generationLinks.versionId))
    .leftJoin(user, eq(user.id, generationLinks.loggedBy))
    .where(eq(generationLinks.workId, workId))
    .orderBy(desc(generationLinks.loggedAt));
}

export const STATUS_LABEL: Record<LyricWorkStatus, string> = { draft: "Draft", final: "Final", released: "Released" };
