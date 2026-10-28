"use server";

import { redirect } from "next/navigation";
import { requireAppContext, runAction } from "@/lib/authz";
import { createThread } from "@/lib/services/chat";
import { acceptSuggestion, dismissSuggestion } from "@/lib/services/suggestions";
import { revalidatePath } from "next/cache";

export async function createThreadAction(formData: FormData) {
  const { ctx } = await requireAppContext();
  const projectId = String(formData.get("projectId") ?? "");
  const thread = await createThread(ctx, { projectId: projectId === "all" ? null : projectId });
  redirect(`/chat/${thread.id}`);
}

export async function acceptSuggestionAction(suggestionId: string, workId: string, body: string, changeNote?: string) {
  const result = await runAction(async ({ ctx }) => {
    const v = await acceptSuggestion(ctx, suggestionId, { body, changeNote });
    return { versionNo: v.versionNo };
  });
  revalidatePath(`/lyrics/${workId}`);
  return result.ok ? { ...result, message: `Saved as version ${result.data!.versionNo}, marked as a human edit of an AI suggestion.` } : result;
}

export async function dismissSuggestionAction(suggestionId: string, workId: string) {
  const result = await runAction(({ ctx }) => dismissSuggestion(ctx, suggestionId), "Suggestion dismissed.");
  revalidatePath(`/lyrics/${workId}`);
  return result;
}
