import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { listAuditEvents } from "@/lib/services/audit";
import {
  addEvidence,
  addVersion,
  createWork,
  listContributors,
  listVersions,
  listWorks,
  logGeneration,
  setContributors,
} from "@/lib/services/lyrics";
import { createProject, setProjectMember } from "@/lib/services/projects";
import { createMember, createWorkspace } from "./fixtures";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const appendOnly = { cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }) };

async function setup() {
  const ws = await createWorkspace();
  const owner = await createMember(ws.id, "owner", "Romel");
  const nikki = await createMember(ws.id, "member", "Nikki");
  const project = await createProject(owner, { name: "Xania", type: "artist" });
  await setProjectMember(owner, project.id, { userId: nikki.userId, role: "editor" });
  return { ws, owner, nikki, project };
}

describe("lyric works and versions", () => {
  it("records versions with a server timestamp and a DB-computed hash", async () => {
    const { nikki, project } = await setup();
    const { work, version } = await createWork(nikki, {
      projectId: project.id,
      title: "Glass Rivers",
      body: "Line one\r\nLine two   \n",
      origin: "imported_original",
      claimedWrittenAt: "2019-06-01",
    });
    expect(version!.body).toBe("Line one\nLine two");
    expect(version!.contentSha256).toBe(sha("Line one\nLine two"));
    expect(version!.claimedWrittenAt).toBe("2019-06-01");
    expect(version!.origin).toBe("imported_original");

    const v2 = await addVersion(nikki, work.id, { body: "Line one\nLine two, changed", baseVersionNo: 1, changeNote: "Tighter" });
    expect(v2.versionNo).toBe(2);
    expect(v2.parentVersionId).toBe(version!.id);
    expect(v2.recordedAt.getTime()).toBeGreaterThanOrEqual(version!.recordedAt.getTime());

    const versions = await listVersions(db, nikki, work.id);
    expect(versions.map((v) => v.version.versionNo)).toEqual([2, 1]);

    const audit = await listAuditEvents(db, nikki, { projectId: project.id, action: "lyric.version" });
    expect(audit.map((a) => (a.event.after as { contentSha256: string }).contentSha256)).toEqual([
      v2.contentSha256,
      version!.contentSha256,
    ]);
  });

  it("refuses to update, delete or truncate versions", async () => {
    const { nikki, project } = await setup();
    const { version } = await createWork(nikki, { projectId: project.id, title: "Fixed", body: "Words" });
    await expect(db.execute(sql`update lyric_versions set body = 'x' where id = ${version!.id}`)).rejects.toMatchObject(appendOnly);
    await expect(db.execute(sql`delete from lyric_versions where id = ${version!.id}`)).rejects.toMatchObject(appendOnly);
    await expect(db.execute(sql`truncate lyric_versions cascade`)).rejects.toMatchObject(appendOnly);
  });

  it("rejects stale edits and no-op versions", async () => {
    const { nikki, owner, project } = await setup();
    const { work } = await createWork(nikki, { projectId: project.id, title: "Race", body: "A" });
    await addVersion(owner, work.id, { body: "B", baseVersionNo: 1 });
    await expect(addVersion(nikki, work.id, { body: "C", baseVersionNo: 1 })).rejects.toThrow(/Someone saved version 2/);
    await expect(addVersion(nikki, work.id, { body: "B", baseVersionNo: 2 })).rejects.toThrow(/Nothing changed/);
  });

  it("keeps works private to the project", async () => {
    const { ws, nikki, project } = await setup();
    const outsider = await createMember(ws.id, "member", "Outsider");
    const { work } = await createWork(nikki, { projectId: project.id, title: "Secret", body: "Hidden" });
    expect(await listWorks(db, outsider)).toEqual([]);
    await expect(listVersions(db, outsider, work.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(createWork(outsider, { projectId: project.id, title: "x", body: "y" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("viewers can read but not write", async () => {
    const { ws, owner, nikki, project } = await setup();
    const viewer = await createMember(ws.id, "member", "Viewer");
    await setProjectMember(owner, project.id, { userId: viewer.userId, role: "viewer" });
    const { work } = await createWork(nikki, { projectId: project.id, title: "Read only", body: "Text" });
    expect(await listVersions(db, viewer, work.id)).toHaveLength(1);
    await expect(addVersion(viewer, work.id, { body: "Edit", baseVersionNo: 1 })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("contributors, evidence and generations", () => {
  it("validates that splits add up to 100% with a human lyricist", async () => {
    const { nikki, project } = await setup();
    const { work } = await createWork(nikki, { projectId: project.id, title: "Split", body: "Text" });
    expect((await listContributors(db, work.id))[0]).toMatchObject({ name: "Nikki", shareBps: 10_000, role: "lyricist" });

    await expect(
      setContributors(nikki, work.id, [
        { name: "Nikki", role: "lyricist", sharePct: 60, human: true },
        { name: "Sam", role: "co-writer", sharePct: 30, human: true },
      ]),
    ).rejects.toThrow(/add up to 100%/);
    await expect(setContributors(nikki, work.id, [{ name: "Bot", role: "lyricist", sharePct: 100, human: false }])).rejects.toThrow(
      /human lyricist/,
    );
    await setContributors(nikki, work.id, [
      { name: "Nikki", role: "lyricist", sharePct: 66.67, human: true },
      { name: "Sam", role: "co-writer", sharePct: 33.33, human: true },
    ]);
    expect((await listContributors(db, work.id)).map((c) => c.shareBps)).toEqual([6667, 3333]);
  });

  it("hashes evidence and keeps it append-only", async () => {
    const { nikki, project } = await setup();
    const { work, version } = await createWork(nikki, { projectId: project.id, title: "Notebook", body: "Ink" });
    const bytes = new TextEncoder().encode("fake jpeg bytes");
    const ev = await addEvidence(nikki, work.id, {
      kind: "notebook_scan",
      versionId: version!.id,
      description: "Page 12",
      filename: "page12.jpg",
      contentType: "image/jpeg",
      bytes,
    });
    expect(ev.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    await expect(db.execute(sql`delete from lyric_evidence where id = ${ev.id}`)).rejects.toMatchObject(appendOnly);
  });

  it("blocks logging a generation before any lyrics exist, or without a version", async () => {
    const { nikki, project } = await setup();
    const { work: empty } = await createWork(nikki, { projectId: project.id, title: "Idea only" });
    await expect(logGeneration(nikki, empty.id, { tool: "Suno" })).rejects.toThrow(/Log the human-written lyrics first/);

    const { work, version } = await createWork(nikki, { projectId: project.id, title: "Ready", body: "Sing this" });
    await expect(logGeneration(nikki, work.id, { tool: "Suno" })).rejects.toThrow(/Choose the lyric version/);
    await expect(logGeneration(nikki, work.id, { tool: "Suno", versionId: empty.id })).rejects.toThrow(/doesn't belong/);
    const link = await logGeneration(nikki, work.id, { tool: "Suno", versionId: version!.id, externalRef: "suno.com/song/abc" });
    expect(link.versionId).toBe(version!.id);
  });
});
