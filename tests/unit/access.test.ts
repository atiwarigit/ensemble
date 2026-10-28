import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { requireProjectRole } from "@/lib/services/access";
import { listAuditEvents } from "@/lib/services/audit";
import { createProject, listProjects, removeProjectMember, setProjectMember } from "@/lib/services/projects";
import { createMember, createWorkspace } from "./fixtures";

describe("project access", () => {
  it("projects are private to members and workspace owners", async () => {
    const ws = await createWorkspace();
    const owner = await createMember(ws.id, "owner", "Romel");
    const nikki = await createMember(ws.id, "member", "Nikki");
    const admin = await createMember(ws.id, "admin", "Admin");

    const project = await createProject(nikki, { name: "Nikki songs", type: "artist" });

    expect((await listProjects(db, nikki)).map((p) => p.id)).toEqual([project.id]);
    expect((await listProjects(db, owner)).map((p) => p.id)).toEqual([project.id]);
    expect(await listProjects(db, admin)).toEqual([]);

    await expect(requireProjectRole(db, admin, project.id, "viewer")).rejects.toMatchObject({ code: "not_found" });
    await expect(requireProjectRole(db, owner, project.id, "lead")).resolves.toMatchObject({ role: "lead" });
  });

  it("enforces minimum project roles", async () => {
    const ws = await createWorkspace();
    const lead = await createMember(ws.id, "member", "Lead");
    const editor = await createMember(ws.id, "member", "Editor");
    const project = await createProject(lead, { name: "Release", type: "release" });
    await setProjectMember(lead, project.id, { userId: editor.userId, role: "editor" });

    await expect(requireProjectRole(db, editor, project.id, "editor")).resolves.toBeTruthy();
    await expect(requireProjectRole(db, editor, project.id, "lead")).rejects.toMatchObject({ code: "forbidden" });
    await expect(setProjectMember(editor, project.id, { userId: editor.userId, role: "lead" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("does not leak projects across workspaces", async () => {
    const wsA = await createWorkspace();
    const wsB = await createWorkspace();
    const ownerA = await createMember(wsA.id, "owner");
    const ownerB = await createMember(wsB.id, "owner");
    const project = await createProject(ownerA, { name: "A only", type: "internal" });
    await expect(requireProjectRole(db, ownerB, project.id, "viewer")).rejects.toMatchObject({ code: "not_found" });
    expect(await listProjects(db, ownerB)).toEqual([]);
  });

  it("keeps at least one lead and audits membership changes", async () => {
    const ws = await createWorkspace();
    const lead = await createMember(ws.id, "member", "Lead");
    const project = await createProject(lead, { name: "Solo", type: "artist" });
    await expect(removeProjectMember(lead, project.id, lead.userId)).rejects.toMatchObject({ code: "conflict" });

    const events = await listAuditEvents(db, lead, { projectId: project.id });
    expect(events.map((e) => e.event.action).sort()).toEqual(["project.created", "project.member.added"]);
  });

  it("hides project audit events from non-members", async () => {
    const ws = await createWorkspace();
    const lead = await createMember(ws.id, "member", "Lead");
    const other = await createMember(ws.id, "member", "Other");
    const project = await createProject(lead, { name: "Secret", type: "artist" });
    const visible = await listAuditEvents(db, other);
    expect(visible.some((e) => e.event.projectId === project.id)).toBe(false);
  });
});
