"use server";

import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/authz";
import { createThread } from "@/lib/services/chat";

export async function createThreadAction(formData: FormData) {
  const { ctx } = await requireAppContext();
  const projectId = String(formData.get("projectId") ?? "");
  const thread = await createThread(ctx, { projectId: projectId === "all" ? null : projectId });
  redirect(`/chat/${thread.id}`);
}
