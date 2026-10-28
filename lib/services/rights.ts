import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { zipSync } from "fflate";
import type { Executor } from "@/db";
import { rightsPackages } from "@/db/schema/approvals";
import { auditEvents } from "@/db/schema/audit";
import { user } from "@/db/schema/auth";
import { generationLinks, lyricEvidence, lyricVersions, lyricWorks } from "@/db/schema/lyrics";
import { renderRightsPdf } from "@/lib/rights/pdf";
import { recordAudit, verifyAuditChain } from "./audit";
import { invalid, notFound, type ServiceContext } from "./context";
import { readFile, sha256Hex, storeFile } from "./files";
import { getWork, listContributors, type Work } from "./lyrics";

export const PACKAGE_FORMAT = "ensemble.rights-package/1";
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;

export const LIMITATION =
  "Server timestamps and the audit hash chain prove when Ensemble recorded each text, not when it was written. " +
  "Dates marked \"stated by the author\" are the author's own claim. Stronger third-party proof (RFC 3161 trusted " +
  "timestamping or copyright registration) is not part of this package. Have counsel review this template before external use.";

export type RightsManifest = Awaited<ReturnType<typeof buildManifest>>;

const without = <T extends object>(o: T, key: keyof T) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const pad = (n: number) => String(n).padStart(3, "0");
const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

/** Everything a rights package says about a work, read in one place so the PDF, ZIP and preview agree. */
export async function buildManifest(exec: Executor, ctx: ServiceContext, work: Work, opts: { packageId: string; kind: "draft" | "final" }) {
  const { project } = await getWork(exec, ctx, work.id);
  const [contributors, versions, evidence, generations] = await Promise.all([
    listContributors(exec, work.id),
    exec
      .select({ v: lyricVersions, authorName: user.name })
      .from(lyricVersions)
      .leftJoin(user, eq(user.id, lyricVersions.authoredBy))
      .where(eq(lyricVersions.workId, work.id))
      .orderBy(asc(lyricVersions.versionNo)),
    exec
      .select({ e: lyricEvidence, uploadedByName: user.name })
      .from(lyricEvidence)
      .leftJoin(user, eq(user.id, lyricEvidence.uploadedBy))
      .where(eq(lyricEvidence.workId, work.id))
      .orderBy(asc(lyricEvidence.uploadedAt)),
    exec
      .select({ g: generationLinks, loggedByName: user.name })
      .from(generationLinks)
      .leftJoin(user, eq(user.id, generationLinks.loggedBy))
      .where(eq(generationLinks.workId, work.id))
      .orderBy(asc(generationLinks.loggedAt)),
  ]);
  if (!versions.length) throw invalid("Add the lyrics before generating a rights package.");
  const [primaryAuthor] = work.primaryAuthorUserId
    ? await exec.select({ name: user.name }).from(user).where(eq(user.id, work.primaryAuthorUserId))
    : [];

  const entityIds = [work.id, ...versions.map((x) => x.v.id), ...evidence.map((x) => x.e.id), ...generations.map((x) => x.g.id)];
  const events = await exec
    .select({ event: auditEvents, actorName: user.name })
    .from(auditEvents)
    .leftJoin(user, eq(user.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.workspaceId, ctx.workspaceId),
        or(
          inArray(auditEvents.entityId, entityIds),
          sql`${auditEvents.entityType} = 'approval_request' and ${auditEvents.after}->>'workId' = ${work.id}`,
          sql`${auditEvents.entityType} = 'rights_package' and ${auditEvents.after}->>'workId' = ${work.id}`,
        ),
      ),
    )
    .orderBy(asc(auditEvents.id));
  const versionEvent = new Map(
    events.filter((e) => e.event.action === "lyric.version.created").map((e) => [e.event.entityId, e.event]),
  );
  const chain = await verifyAuditChain(exec);

  const generatedAt = new Date();
  return {
    format: PACKAGE_FORMAT,
    packageId: opts.packageId,
    kind: opts.kind,
    generatedAt: generatedAt.toISOString(),
    generatedBy: ctx.userId,
    work: {
      id: work.id,
      title: work.title,
      status: opts.kind === "final" ? "final" : work.status,
      isrc: work.isrc,
      iswc: work.iswc,
      primaryAuthor: primaryAuthor?.name ?? null,
      finalizedAt: work.finalizedAt?.toISOString() ?? null,
    },
    project: { id: project.id, name: project.name, artistName: project.artistName },
    contributors: contributors.map((c) => ({
      name: c.name,
      role: c.role,
      sharePct: c.shareBps / 100,
      shareBps: c.shareBps,
      human: c.human,
      isMember: c.userId !== null,
    })),
    versions: versions.map(({ v, authorName }) => {
      const ev = versionEvent.get(v.id);
      return {
        versionNo: v.versionNo,
        id: v.id,
        recordedAt: v.recordedAt.toISOString(),
        author: authorName,
        origin: v.origin,
        authorStatedWrittenAt: v.claimedWrittenAt,
        contentSha256: v.contentSha256,
        changeNote: v.changeNote,
        file: `versions/v${pad(v.versionNo)}.txt`,
        auditEventId: ev?.id ?? null,
        auditEventHash: ev?.hash ?? null,
        body: v.body,
      };
    }),
    evidence: evidence.map(({ e, uploadedByName }, i) => ({
      id: e.id,
      kind: e.kind,
      filename: e.filename,
      description: e.description,
      sizeBytes: e.sizeBytes,
      sha256: e.sha256,
      versionNo: versions.find((x) => x.v.id === e.versionId)?.v.versionNo ?? null,
      uploadedAt: e.uploadedAt.toISOString(),
      uploadedBy: uploadedByName,
      fileId: e.fileId,
      file: `evidence/${String(i + 1).padStart(2, "0")}-${safeName(e.filename)}`,
    })),
    generations: generations.map(({ g, loggedByName }) => ({
      tool: g.tool,
      externalRef: g.externalRef,
      notes: g.notes,
      versionNo: versions.find((x) => x.v.id === g.versionId)!.v.versionNo,
      versionSha256: versions.find((x) => x.v.id === g.versionId)!.v.contentSha256,
      loggedAt: g.loggedAt.toISOString(),
      loggedBy: loggedByName,
    })),
    statement: {
      human:
        "The lyrics recorded in this package were written by the human contributors listed above. " +
        "Every version was entered into Ensemble by the person shown as its author.",
      ai: generations.length
        ? "Recordings produced with the generation tools listed above contain AI-generated music and vocals. " +
          "Each tool was given the human-written lyric version shown for that entry; the tools did not write the lyrics."
        : "No AI generations have been logged for this work.",
    },
    audit: {
      events: events.map(({ event: e, actorName }) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        action: e.action,
        actor: actorName,
        entityType: e.entityType,
        entityId: e.entityId,
        prevHash: e.prevHash,
        hash: e.hash,
      })),
      chainHead: chain.head,
      chainVerified: chain.ok,
      eventCount: chain.count,
    },
    limitation: LIMITATION,
  };
}

/** Builds the PDF and ZIP for a work, stores them, and audits the generation. */
export async function generateRightsPackage(
  exec: Executor,
  ctx: ServiceContext,
  work: Work,
  opts: { kind: "draft" | "final"; approvalRequestId?: string | null },
) {
  const packageId = randomUUID();
  const manifest = await buildManifest(exec, ctx, work, { packageId, kind: opts.kind });
  const pdf = await renderRightsPdf(manifest);
  const { versions, evidence, ...rest } = manifest;
  const manifestJson = JSON.stringify(
    {
      ...rest,
      versions: versions.map((v) => without(v, "body")),
      evidence: evidence.map((e) => without(e, "fileId")),
    },
    null,
    2,
  );

  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    "rights-package.pdf": pdf,
    "manifest.json": enc.encode(manifestJson),
  };
  for (const v of versions) files[v.file] = enc.encode(v.body);
  for (const e of evidence) files[e.file] = new Uint8Array((await readFile(exec, ctx, e.fileId)).data);
  const sha256sums = Object.entries(files)
    .map(([name, bytes]) => `${sha256Hex(bytes)}  ${name}`)
    .join("\n")
    .concat("\n");
  files.SHA256SUMS = enc.encode(sha256sums);

  const mtime = new Date(manifest.generatedAt);
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { mtime }]])), { level: 6 });
  const stamp = manifest.generatedAt.slice(0, 10);
  const filename = `${safeName(work.title).replace(/\s+/g, "-")}-rights-${opts.kind}-${stamp}.zip`;
  const file = await storeFile(exec, ctx, { filename, contentType: "application/zip", bytes: zip }, { maxBytes: MAX_PACKAGE_BYTES });

  const [pkg] = await exec
    .insert(rightsPackages)
    .values({
      id: packageId,
      workspaceId: ctx.workspaceId,
      workId: work.id,
      kind: opts.kind,
      fileId: file.id,
      filename,
      sizeBytes: file.sizeBytes,
      zipSha256: file.sha256,
      pdfSha256: sha256Hex(pdf),
      manifestSha256: sha256Hex(files["manifest.json"]),
      sha256sums,
      chainHeadId: manifest.audit.chainHead?.id ?? null,
      chainHeadHash: manifest.audit.chainHead?.hash ?? null,
      approvalRequestId: opts.approvalRequestId ?? null,
      createdBy: ctx.userId,
    })
    .returning();
  await recordAudit(exec, ctx, {
    action: "rights.package.generated",
    projectId: work.projectId,
    entityType: "rights_package",
    entityId: pkg.id,
    after: {
      workId: work.id,
      kind: pkg.kind,
      zipSha256: pkg.zipSha256,
      pdfSha256: pkg.pdfSha256,
      manifestSha256: pkg.manifestSha256,
      versions: versions.map((v) => ({ versionNo: v.versionNo, contentSha256: v.contentSha256 })),
      chainHead: manifest.audit.chainHead,
      approvalRequestId: pkg.approvalRequestId,
    },
  });
  return pkg;
}

/** Draft packages are for review and carry a DRAFT watermark; any editor can make one. */
export async function generateDraftPackage(exec: Executor, ctx: ServiceContext, workId: string) {
  const { work, role } = await getWork(exec, ctx, workId);
  if (role === "viewer") throw notFound("Lyric not found.");
  return generateRightsPackage(exec, ctx, work, { kind: "draft" });
}

/** Checks a work can be finalized. Used when the request is made and again when it's approved. */
export async function assertFinalizable(exec: Executor, work: Work) {
  if (work.status !== "draft") throw invalid(`This work is already ${work.status}.`);
  const [{ count }] = await exec
    .select({ count: sql<number>`count(*)::int` })
    .from(lyricVersions)
    .where(eq(lyricVersions.workId, work.id));
  if (!count) throw invalid("Add the lyrics before finalizing.");
}

/** Runs only from an approved `lyric.finalize` request: freezes the work and its split and issues the final package. */
export async function finalizeWorkTx(exec: Executor, ctx: ServiceContext, workId: string, approvalRequestId: string) {
  const [locked] = await exec.select().from(lyricWorks).where(eq(lyricWorks.id, workId)).for("update");
  if (!locked) throw notFound("Lyric not found.");
  const { work } = await getWork(exec, ctx, workId);
  await assertFinalizable(exec, work);
  const [finalized] = await exec
    .update(lyricWorks)
    .set({ status: "final", finalizedAt: new Date(), finalizedBy: ctx.userId })
    .where(eq(lyricWorks.id, workId))
    .returning();
  const contributors = await listContributors(exec, workId);
  await recordAudit(exec, ctx, {
    action: "lyric.work.finalized",
    projectId: work.projectId,
    entityType: "lyric_work",
    entityId: work.id,
    before: { status: work.status },
    after: {
      status: "final",
      approvalRequestId,
      contributors: contributors.map((c) => ({ name: c.name, role: c.role, sharePct: c.shareBps / 100, human: c.human })),
    },
  });
  const pkg = await generateRightsPackage(exec, ctx, finalized, { kind: "final", approvalRequestId });
  return { packageId: pkg.id, zipSha256: pkg.zipSha256 };
}

export async function listPackages(exec: Executor, ctx: ServiceContext, workId: string) {
  await getWork(exec, ctx, workId);
  return exec
    .select({ pkg: rightsPackages, createdByName: user.name })
    .from(rightsPackages)
    .leftJoin(user, eq(user.id, rightsPackages.createdBy))
    .where(eq(rightsPackages.workId, workId))
    .orderBy(desc(rightsPackages.createdAt));
}

export async function downloadPackage(exec: Executor, ctx: ServiceContext, packageId: string) {
  const [pkg] = await exec
    .select()
    .from(rightsPackages)
    .where(and(eq(rightsPackages.id, packageId), eq(rightsPackages.workspaceId, ctx.workspaceId)));
  if (!pkg) throw notFound("Package not found.");
  const { work } = await getWork(exec, ctx, pkg.workId);
  const file = await readFile(exec, ctx, pkg.fileId);
  await recordAudit(exec, ctx, {
    action: "rights.package.downloaded",
    projectId: work.projectId,
    entityType: "rights_package",
    entityId: pkg.id,
    after: { workId: work.id, kind: pkg.kind, zipSha256: pkg.zipSha256 },
  });
  return { pkg, data: file.data };
}
