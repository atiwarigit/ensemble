import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { approvalRequests, rightsPackages } from "@/db/schema/approvals";
import { storedFiles } from "@/db/schema/files";
import { importBatches } from "@/db/schema/expenses";
import { listAuditEvents } from "@/lib/services/audit";
import { countAwaitingMe, decideApproval, listApprovals, requestApproval } from "@/lib/services/approvals";
import { seedDefaultCategories } from "@/lib/services/expenses";
import { commitImport, createImport, LARGE_IMPORT_ROWS } from "@/lib/services/imports";
import { addEvidence, addVersion, createWork, getWork, listContributors, logGeneration, setContributors } from "@/lib/services/lyrics";
import { createProject, getProject, setProjectMember } from "@/lib/services/projects";
import { downloadPackage, generateDraftPackage } from "@/lib/services/rights";
import { createMember, createWorkspace } from "./fixtures";

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

async function setup() {
  const ws = await createWorkspace();
  await seedDefaultCategories(db, ws.id);
  const owner = await createMember(ws.id, "owner", "Romel");
  const nikki = await createMember(ws.id, "member", "Nikki");
  const dee = await createMember(ws.id, "member", "Dee");
  const project = await createProject(nikki, { name: "Nikki Songs", type: "artist" });
  await setProjectMember(nikki, project.id, { userId: dee.userId, role: "editor" });
  return { ws, owner, nikki, dee, project };
}

async function workWithHistory(ctx: Parameters<typeof createWork>[0], projectId: string) {
  const { work } = await createWork(ctx, {
    projectId,
    title: "Paper Lanterns",
    body: "We folded light\nfrom yesterday's news",
    origin: "imported_original",
    claimedWrittenAt: "2019-06-01",
  });
  const v2 = await addVersion(ctx, work.id, { body: "We folded light\nfrom yesterday's papers", baseVersionNo: 1 });
  await addEvidence(ctx, work.id, {
    kind: "notebook_scan",
    description: "Notebook page",
    filename: "page.jpg",
    contentType: "image/jpeg",
    bytes: new TextEncoder().encode("fake jpeg bytes"),
  });
  await logGeneration(ctx, work.id, { tool: "Suno", versionId: v2.id, externalRef: "https://suno.com/song/x" });
  return work;
}

describe("approval requests", () => {
  it("finalizing needs someone else's approval, locks the work and issues a package whose hashes match the audit log", async () => {
    const { owner, nikki, dee, project } = await setup();
    const work = await workWithHistory(nikki, project.id);
    const req = await requestApproval(nikki, "lyric.finalize", { workId: work.id }, "Ready for registration");
    expect(req.status).toBe("pending");
    expect(req.requiredRole).toBe("lead");
    expect(await countAwaitingMe(db, owner)).toBe(1);
    expect(await countAwaitingMe(db, nikki)).toBe(0);

    // Nikki leads the project but can't approve her own request; Dee is only an editor.
    await expect(decideApproval(nikki, req.id, { decision: "approve" })).rejects.toThrow(/your own request/);
    await expect(decideApproval(dee, req.id, { decision: "approve" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(requestApproval(dee, "lyric.finalize", { workId: work.id })).rejects.toMatchObject({ code: "conflict" });

    const decided = await decideApproval(owner, req.id, { decision: "approve", note: "Looks right" });
    expect(decided.status).toBe("executed");
    expect(decided.decidedBy).toBe(owner.userId);

    const { work: final } = await getWork(db, nikki, work.id);
    expect(final.status).toBe("final");
    expect(final.finalizedBy).toBe(owner.userId);
    await expect(addVersion(nikki, work.id, { body: "new text", baseVersionNo: 2 })).rejects.toThrow(/locked/);
    await expect(
      setContributors(nikki, work.id, [{ name: "Nikki", role: "lyricist", sharePct: 100, human: true }]),
    ).rejects.toThrow(/locked/);

    const [pkg] = await db.select().from(rightsPackages).where(eq(rightsPackages.workId, work.id));
    expect(pkg.kind).toBe("final");
    expect(pkg.approvalRequestId).toBe(req.id);
    const { data } = await db.transaction((tx) => downloadPackage(tx, owner, pkg.id));
    expect(sha(data)).toBe(pkg.zipSha256);

    const files = unzipSync(new Uint8Array(data));
    expect(Object.keys(files).sort()).toEqual(
      ["SHA256SUMS", "evidence/01-page.jpg", "manifest.json", "rights-package.pdf", "versions/v001.txt", "versions/v002.txt"].sort(),
    );
    for (const line of strFromU8(files.SHA256SUMS).trim().split("\n")) {
      const [hash, name] = line.split(/\s+/);
      expect(sha(files[name])).toBe(hash);
    }
    expect(strFromU8(files["rights-package.pdf"].slice(0, 5))).toBe("%PDF-");

    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.kind).toBe("final");
    expect(manifest.audit.chainVerified).toBe(true);
    const audit = await listAuditEvents(db, owner, { projectId: project.id, limit: 200 });
    const byId = new Map(audit.map((a) => [a.event.id, a.event]));
    for (const v of manifest.versions) {
      expect(sha(files[v.file])).toBe(v.contentSha256);
      const ev = byId.get(v.auditEventId)!;
      expect(ev.hash).toBe(v.auditEventHash);
      expect((ev.after as { contentSha256: string }).contentSha256).toBe(v.contentSha256);
    }
    expect(manifest.evidence[0].sha256).toBe(sha("fake jpeg bytes"));
    expect(manifest.generations[0]).toMatchObject({ tool: "Suno", versionNo: 2 });
    expect(manifest.versions[0].authorStatedWrittenAt).toBe("2019-06-01");

    const actions = audit.map((a) => a.event.action);
    for (const a of ["approval.requested", "approval.approved", "lyric.work.finalized", "rights.package.generated", "approval.executed", "rights.package.downloaded"]) {
      expect(actions).toContain(a);
    }
    const approved = audit.find((a) => a.event.action === "approval.approved")!;
    expect(approved.event.actorUserId).toBe(owner.userId);
    expect(approved.event.after).toMatchObject({ selfApproved: false, workId: work.id });
  });

  it("split changes on a final work go through approval and issue a new final package", async () => {
    const { owner, nikki, project } = await setup();
    const work = await workWithHistory(nikki, project.id);
    const fin = await requestApproval(nikki, "lyric.finalize", { workId: work.id });
    await decideApproval(owner, fin.id, { decision: "approve" });

    const split = [
      { name: "Nikki", userId: nikki.userId, role: "lyricist" as const, sharePct: 70, human: true },
      { name: "Dee Rivers", role: "co-writer" as const, sharePct: 30, human: true },
    ];
    await expect(
      requestApproval(nikki, "lyric.contributors.change", { workId: work.id, contributors: [{ ...split[0], sharePct: 90 }] }),
    ).rejects.toThrow(/add up to 100%/);
    const req = await requestApproval(nikki, "lyric.contributors.change", { workId: work.id, contributors: split });
    expect(req.summary).toContain("Nikki 70%, Dee Rivers 30%");
    await decideApproval(owner, req.id, { decision: "approve" });
    expect((await listContributors(db, work.id)).map((c) => [c.name, c.shareBps])).toEqual([
      ["Nikki", 7000],
      ["Dee Rivers", 3000],
    ]);
    const packages = await db.select().from(rightsPackages).where(eq(rightsPackages.workId, work.id));
    expect(packages.filter((p) => p.kind === "final")).toHaveLength(2);
  });

  it("owners can approve their own requests, and it's flagged", async () => {
    const { owner, project } = await setup();
    const req = await requestApproval(owner, "project.archive", { projectId: project.id });
    expect(req.requiredRole).toBe("owner");
    await decideApproval(owner, req.id, { decision: "approve" });
    const { project: p } = await getProject(db, owner, project.id);
    expect(p.archivedAt).not.toBeNull();
    const [ev] = await listAuditEvents(db, owner, { action: "approval.approved", projectId: project.id });
    expect(ev.event.after).toMatchObject({ selfApproved: true });
  });

  it("owner-only actions can't be approved by a project lead", async () => {
    const { owner, nikki, dee, project } = await setup();
    const req = await requestApproval(dee, "lyric.finalize", { workId: (await workWithHistory(dee, project.id)).id });
    await expect(decideApproval(nikki, req.id, { decision: "approve" })).resolves.toMatchObject({ status: "executed" });

    const llm = await requestApproval(nikki, "project.allow_llm_on_lyrics", { projectId: project.id });
    await expect(decideApproval(nikki, llm.id, { decision: "approve" })).rejects.toThrow(/workspace owner/);
    await decideApproval(owner, llm.id, { decision: "approve" });
    const { project: p } = await getProject(db, owner, project.id);
    expect(p.settings.allow_llm_on_lyrics).toBe(true);
  });

  it("requesters can withdraw; decided requests can't be decided or edited again", async () => {
    const { owner, nikki, project } = await setup();
    const req = await requestApproval(nikki, "project.archive", { projectId: project.id });
    const withdrawn = await decideApproval(nikki, req.id, { decision: "reject" });
    expect(withdrawn.status).toBe("rejected");
    expect(withdrawn.decisionNote).toBe("Withdrawn");
    await expect(decideApproval(owner, req.id, { decision: "approve" })).rejects.toThrow(/already rejected/);
    await expect(db.update(approvalRequests).set({ reason: "edited" }).where(eq(approvalRequests.id, req.id))).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/already rejected/) }),
    });
    await expect(db.delete(approvalRequests).where(eq(approvalRequests.id, req.id))).rejects.toBeTruthy();
    const [ev] = await listAuditEvents(db, owner, { action: "approval.withdrawn" });
    expect(ev.event.entityId).toBe(req.id);
  });

  it("requests expire after their deadline", async () => {
    const { owner, nikki, project } = await setup();
    const req = await requestApproval(nikki, "project.archive", { projectId: project.id });
    await db.execute(sql`update approval_requests set expires_at = now() - interval '1 minute' where id = ${req.id}`);
    await expect(decideApproval(owner, req.id, { decision: "approve" })).rejects.toThrow(/already expired/);
    const [history] = await listApprovals(db, owner, { scope: "decided" });
    expect(history.req.status).toBe("expired");
    const [ev] = await listAuditEvents(db, owner, { action: "approval.expired" });
    expect(ev.event.actorType).toBe("system");
  });

  it("if the action is no longer valid at approval time, the request fails and nothing changes", async () => {
    const { owner, nikki, project } = await setup();
    const csv = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,10/27/2026,SUNO INC,-30.00,DEBIT_CARD,100,,\n";
    const { batch } = await createImport(nikki, { filename: "one.csv", bytes: new TextEncoder().encode(csv), projectId: project.id });
    await commitImport(nikki, batch.id);
    const req = await requestApproval(nikki, "import.revert", { batchId: batch.id });
    await db.update(importBatches).set({ status: "reverted" }).where(eq(importBatches.id, batch.id));
    const decided = await decideApproval(owner, req.id, { decision: "approve" });
    expect(decided.status).toBe("failed");
    expect(decided.error).toMatch(/Only committed imports/);
    const [ev] = await listAuditEvents(db, owner, { action: "approval.failed" });
    expect(ev.event.entityId).toBe(req.id);
  });

  it("imports over the row limit can only be committed through an approval", async () => {
    const { owner, nikki, project } = await setup();
    const rows = Array.from({ length: LARGE_IMPORT_ROWS + 5 }, (_, i) => `DEBIT,10/01/2026,"VENDOR ${i}",-1.${String(i % 100).padStart(2, "0")},DEBIT_CARD,0,,`);
    const csv = ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #", ...rows].join("\n");
    const { batch } = await createImport(nikki, { filename: "big.csv", bytes: new TextEncoder().encode(csv), projectId: project.id });
    await expect(commitImport(nikki, batch.id)).rejects.toThrow(/need an approval/);
    const req = await requestApproval(nikki, "import.commit_large", { batchId: batch.id });
    expect(req.summary).toContain(`Import ${LARGE_IMPORT_ROWS + 5} expenses`);
    const decided = await decideApproval(owner, req.id, { decision: "approve" });
    expect(decided.result).toMatchObject({ inserted: LARGE_IMPORT_ROWS + 5 });
  });

  it("rejects unknown actions and payloads that don't match the action's schema", async () => {
    const { nikki } = await setup();
    await expect(requestApproval(nikki, "expense.delete_all" as never, {} as never)).rejects.toThrow(/Unknown approval action/);
    await expect(requestApproval(nikki, "lyric.finalize", { workId: "not-a-uuid" })).rejects.toBeTruthy();
  });

  it("draft packages are watermarked drafts, and packages are append-only", async () => {
    const { nikki, project } = await setup();
    const work = await workWithHistory(nikki, project.id);
    const pkg = await db.transaction((tx) => generateDraftPackage(tx, nikki, work.id));
    expect(pkg.kind).toBe("draft");
    const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, pkg.fileId));
    const manifest = JSON.parse(strFromU8(unzipSync(new Uint8Array(file.data))["manifest.json"]));
    expect(manifest.kind).toBe("draft");
    expect(manifest.work.status).toBe("draft");
    await expect(db.delete(rightsPackages).where(eq(rightsPackages.id, pkg.id))).rejects.toBeTruthy();
  });
});
