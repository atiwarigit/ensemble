import "server-only";

import { db } from "@/db";
import type { ServiceContext } from "@/lib/services/context";
import { listCategories, type ExpenseFilters } from "@/lib/services/expenses";
import { listProjects } from "@/lib/services/projects";

export type Option = { id: string; name: string };

export async function expenseOptions(ctx: ServiceContext) {
  const [projects, categories] = await Promise.all([listProjects(db, ctx), listCategories(db, ctx)]);
  return {
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    categories: categories.map((c) => ({ id: c.id, name: c.fullName, parentId: c.parentId })),
  };
}

export function readFilters(sp: Record<string, string | string[] | undefined>): ExpenseFilters {
  const get = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  return {
    projectId: get("project"),
    categoryId: get("category"),
    month: get("month"),
    q: get("q"),
    importBatchId: get("batch"),
  };
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
