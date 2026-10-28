"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction } from "@/lib/authz";
import {
  addEvidence,
  addVersion,
  createWork,
  logGeneration,
  setContributors,
  updateWork,
  type ContributorsInput,
} from "@/lib/services/lyrics";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export type FormState = { error?: string } | undefined;

export async function createWorkAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await runAction(({ ctx }) =>
    createWork(ctx, {
      projectId: str(form, "projectId"),
      title: str(form, "title"),
      body: str(form, "body"),
      origin: str(form, "origin") === "imported_original" ? "imported_original" : "human",
      claimedWrittenAt: str(form, "claimedWrittenAt"),
      changeNote: str(form, "changeNote"),
    }),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/lyrics");
  redirect(`/lyrics/${result.data!.work.id}`);
}

export async function addVersionAction(workId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const result = await runAction(({ ctx }) =>
    addVersion(ctx, workId, {
      body: str(form, "body"),
      changeNote: str(form, "changeNote"),
      baseVersionNo: str(form, "baseVersionNo"),
    }),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath(`/lyrics/${workId}`, "layout");
  redirect(`/lyrics/${workId}?saved=${result.data!.versionNo}`);
}

export async function updateWorkAction(workId: string, form: FormData) {
  const result = await runAction(
    ({ ctx }) => updateWork(ctx, workId, { title: str(form, "title"), isrc: str(form, "isrc"), iswc: str(form, "iswc") }),
    "Details saved.",
  );
  revalidatePath(`/lyrics/${workId}`, "layout");
  return result;
}

export async function saveContributorsAction(workId: string, rows: ContributorsInput) {
  const result = await runAction(({ ctx }) => setContributors(ctx, workId, rows), "Contributors saved.");
  revalidatePath(`/lyrics/${workId}`, "layout");
  return result;
}

export async function addEvidenceAction(workId: string, form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "Choose a file to attach." };
  const result = await runAction(
    async ({ ctx }) =>
      addEvidence(ctx, workId, {
        kind: str(form, "kind") as "notebook_scan",
        versionId: str(form, "versionId").replace("__none", ""),
        description: str(form, "description"),
        filename: file.name,
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }),
    "Evidence attached.",
  );
  revalidatePath(`/lyrics/${workId}`, "layout");
  return result;
}

export async function logGenerationAction(workId: string, form: FormData) {
  const result = await runAction(
    ({ ctx }) =>
      logGeneration(ctx, workId, {
        versionId: str(form, "versionId").replace("__none", ""),
        tool: str(form, "tool"),
        externalRef: str(form, "externalRef"),
        notes: str(form, "notes"),
      }),
    "Generation logged.",
  );
  revalidatePath(`/lyrics/${workId}`, "layout");
  return result;
}
