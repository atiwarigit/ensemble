"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/authz";
import {
  createProject,
  removeProjectMember,
  setProjectArchived,
  setProjectMember,
  updateProject,
} from "@/lib/services/projects";

function projectFields(form: FormData) {
  return {
    name: String(form.get("name") ?? ""),
    type: String(form.get("type") ?? "artist") as "artist" | "release" | "internal",
    artistName: String(form.get("artistName") ?? ""),
    description: String(form.get("description") ?? ""),
  };
}

export async function createProjectAction(form: FormData) {
  const result = await runAction(({ ctx }) => createProject(ctx, projectFields(form)), "Project created.");
  if (result.ok) revalidatePath("/", "layout");
  return result.ok ? { ...result, data: { id: result.data!.id } } : result;
}

export async function updateProjectAction(projectId: string, form: FormData) {
  const result = await runAction(async ({ ctx }) => {
    await updateProject(ctx, projectId, projectFields(form));
  }, "Project updated.");
  revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function setArchivedAction(projectId: string, archived: boolean) {
  const result = await runAction(
    ({ ctx }) => setProjectArchived(ctx, projectId, archived),
    archived ? "Project archived." : "Project restored.",
  );
  revalidatePath("/", "layout");
  return result;
}

export async function setProjectMemberAction(projectId: string, userId: string, role: string) {
  const result = await runAction(
    ({ ctx }) => setProjectMember(ctx, projectId, { userId, role: role as "lead" | "editor" | "viewer" }),
    "Member updated.",
  );
  revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function removeProjectMemberAction(projectId: string, userId: string) {
  const result = await runAction(({ ctx }) => removeProjectMember(ctx, projectId, userId), "Member removed.");
  revalidatePath(`/projects/${projectId}`);
  return result;
}
