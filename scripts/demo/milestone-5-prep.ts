// Demo data for the Milestone 5 recording, on top of the Milestone 3/4 demo data: October expenses
// in "Nikki Songs", a monthly budget, and a draft lyric with AI access to lyrics turned on.
// Usage: pnpm exec tsx scripts/demo/milestone-5-prep.ts
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { lyricWorks } from "@/db/schema/lyrics";
import { projects, workspaceMembers } from "@/db/schema/tenancy";
import type { ServiceContext } from "@/lib/services/context";
import {
  createExpense,
  listCategories,
  upsertBudget,
} from "@/lib/services/expenses";
import { createWork } from "@/lib/services/lyrics";
import { setAllowLlmOnLyricsTx } from "@/lib/services/projects";

async function ctxFor(email: string): Promise<ServiceContext> {
  const [row] = await db
    .select({
      userId: user.id,
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
    })
    .from(user)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, user.id))
    .where(eq(user.email, email));
  return {
    userId: row.userId,
    workspaceId: row.workspaceId,
    workspaceRole: row.role,
    actorType: "user",
  };
}

async function main() {
  const romel = await ctxFor("romel@ensemble.local");
  const nikki = await ctxFor("nikki@ensemble.local");
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.name, "Nikki Songs"));
  const cats = await listCategories(db, romel);
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;

  const rows: [string, string, string, string][] = [
    ["2026-10-02", "30.00", "Suno Pro monthly", "Suno"],
    ["2026-10-09", "35.00", "Kling credits for the lyric video", "Kling"],
    ["2026-10-14", "450.00", "Studio B, vocal session", "Studio"],
    ["2026-10-20", "19.99", "DistroKid", "Software"],
    ["2026-10-24", "120.00", "Instagram promo", "Marketing"],
  ];
  for (const [date, amount, description, category] of rows) {
    await createExpense(romel, {
      date,
      amount,
      description,
      categoryId: cat(category),
      projectId: project.id,
    });
  }
  await upsertBudget(romel, {
    projectId: project.id,
    categoryId: cat("Generation"),
    period: "month",
    amount: "100",
    alertAtPct: 80,
  });

  const existing = await db
    .select()
    .from(lyricWorks)
    .where(
      and(
        eq(lyricWorks.projectId, project.id),
        eq(lyricWorks.title, "Glass Rivers"),
      ),
    );
  if (!existing.length) {
    await createWork(nikki, {
      projectId: project.id,
      title: "Glass Rivers",
      body: "Under the bridge the water sings\nof all the things we couldn't say\nwe kept the light on paper wings\nand let the river carry them away",
    });
  }
  if (!project.settings.allow_llm_on_lyrics) {
    await db.transaction((tx) =>
      setAllowLlmOnLyricsTx(tx, romel, project.id, true),
    );
  }
  console.log("prepared");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
