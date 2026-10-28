"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/authz";
import { lowerBudget, setLlmPreference } from "@/lib/services/ai-settings";
import type { LlmPreference } from "@/db/schema/tenancy";

export async function setPreferenceAction(pref: LlmPreference) {
  const r = await runAction(({ ctx }) => setLlmPreference(ctx, pref), "Saved.");
  revalidatePath("/", "layout");
  return r;
}

export async function lowerBudgetAction(usd: number) {
  const r = await runAction(({ ctx }) => lowerBudget(ctx, usd), "Budget updated.");
  revalidatePath("/settings/ai");
  return r;
}
