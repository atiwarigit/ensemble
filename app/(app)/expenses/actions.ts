"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction } from "@/lib/authz";
import {
  archiveExpense,
  createCategory,
  createExpense,
  createRule,
  deleteBudget,
  deleteRule,
  updateExpense,
  upsertBudget,
} from "@/lib/services/expenses";
import { commitImport, createImport, discardImport, updateImportMapping } from "@/lib/services/imports";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

function expenseFields(form: FormData) {
  return {
    date: str(form, "date"),
    amount: str(form, "amount"),
    currency: "USD" as const,
    merchant: str(form, "merchant"),
    description: str(form, "description"),
    categoryId: str(form, "categoryId").replace("__none", ""),
    projectId: str(form, "projectId").replace("personal", ""),
    paymentAccount: str(form, "paymentAccount"),
    notes: str(form, "notes"),
  };
}

export async function saveExpenseAction(expenseId: string | null, form: FormData) {
  const result = await runAction(async ({ ctx }) => {
    if (expenseId) await updateExpense(ctx, expenseId, expenseFields(form));
    else await createExpense(ctx, expenseFields(form));
  }, expenseId ? "Expense updated." : "Expense added.");
  revalidatePath("/expenses", "layout");
  return result;
}

export async function deleteExpenseAction(expenseId: string) {
  const result = await runAction(({ ctx }) => archiveExpense(ctx, expenseId), "Expense deleted.");
  revalidatePath("/expenses", "layout");
  return result;
}

export type UploadState = { error?: string } | undefined;

export async function uploadImportAction(_prev: UploadState, form: FormData): Promise<UploadState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to import." };
  const projectId = str(form, "projectId");
  const result = await runAction(async ({ ctx }) =>
    createImport(ctx, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      projectId: projectId && projectId !== "personal" ? projectId : null,
    }),
  );
  if (!result.ok) return { error: result.error };
  redirect(`/expenses/import/${result.data!.batch.id}`);
}

export async function updateMappingAction(batchId: string, form: FormData) {
  const col = (k: string) => {
    const v = str(form, k);
    return v && v !== "__none" ? v : null;
  };
  const result = await runAction(
    ({ ctx }) =>
      updateImportMapping(ctx, batchId, {
        columnMap: {
          date: col("date") ?? "",
          description: col("description") ?? "",
          amount: col("amount"),
          debit: col("debit"),
          credit: col("credit"),
          merchant: col("merchant"),
          category: col("category"),
          account: col("account"),
          currency: col("currency"),
        },
        amountMode: str(form, "amountMode") as "negative_is_expense" | "positive_is_expense" | "split",
        dateFormat: str(form, "dateFormat") as "YYYY-MM-DD",
        saveAs: str(form, "saveAs") || undefined,
      }),
    str(form, "saveAs") ? "Mapping saved as a preset." : "Preview updated.",
  );
  revalidatePath(`/expenses/import/${batchId}`);
  return result;
}

export async function commitImportAction(batchId: string) {
  const result = await runAction(async ({ ctx }) => {
    const b = await commitImport(ctx, batchId);
    return { inserted: b.inserted, skipped: b.skippedDupes };
  });
  revalidatePath("/expenses", "layout");
  return result;
}

export async function discardImportAction(batchId: string) {
  const result = await runAction(({ ctx }) => discardImport(ctx, batchId), "Import discarded.");
  if (result.ok) redirect("/expenses/import");
  return result;
}

export async function createRuleAction(form: FormData) {
  const result = await runAction(
    ({ ctx }) =>
      createRule(ctx, {
        matchField: str(form, "matchField") as "merchant" | "description",
        pattern: str(form, "pattern"),
        categoryId: str(form, "categoryId"),
        priority: Number(str(form, "priority") || 100),
      }),
    "Rule added.",
  );
  revalidatePath("/expenses/rules");
  return result;
}

export async function deleteRuleAction(ruleId: string) {
  const result = await runAction(({ ctx }) => deleteRule(ctx, ruleId), "Rule deleted.");
  revalidatePath("/expenses/rules");
  return result;
}

export async function createCategoryAction(form: FormData) {
  const result = await runAction(
    ({ ctx }) =>
      createCategory(ctx, {
        name: str(form, "name"),
        parentId: str(form, "parentId").replace("__none", "") || null,
        isGenerationCost: form.get("isGenerationCost") === "on",
      }),
    "Category added.",
  );
  revalidatePath("/expenses", "layout");
  return result;
}

export async function saveBudgetAction(form: FormData) {
  const result = await runAction(
    ({ ctx }) =>
      upsertBudget(ctx, {
        projectId: str(form, "projectId"),
        categoryId: str(form, "categoryId").replace("__all", "") || null,
        period: str(form, "period") as "month" | "quarter" | "total",
        amount: str(form, "amount"),
        alertAtPct: Number(str(form, "alertAtPct") || 80),
      }),
    "Budget saved.",
  );
  revalidatePath("/expenses", "layout");
  return result;
}

export async function deleteBudgetAction(budgetId: string) {
  const result = await runAction(({ ctx }) => deleteBudget(ctx, budgetId), "Budget deleted.");
  revalidatePath("/expenses", "layout");
  return result;
}
