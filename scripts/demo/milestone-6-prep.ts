// Demo data for the Milestone 6 recording, on top of the Milestone 3–5 demo data in "Nikki Songs":
// ISRCs on the lyric works (so songs match Spotify tracks) and the October marketing spend that
// the Analytics agent lines up against the streams jump.
//   pnpm exec tsx scripts/demo/milestone-6-prep.ts            # before recording
//   pnpm exec tsx scripts/demo/milestone-6-prep.ts backdate   # mid-recording, before the extended-access snapshot
// "backdate" stands in for a week of daily snapshots: one artist snapshot 8 days ago with higher
// popularity and fewer followers, so the next extended-access snapshot has something to compare to.
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { spotifyArtists, spotifySnapshots } from "@/db/schema/analytics";
import { user } from "@/db/schema/auth";
import { lyricWorks } from "@/db/schema/lyrics";
import { projects, workspaceMembers } from "@/db/schema/tenancy";
import type { ServiceContext } from "@/lib/services/context";
import { createExpense, listCategories } from "@/lib/services/expenses";

async function ctxFor(email: string): Promise<ServiceContext> {
  const [row] = await db
    .select({ userId: user.id, workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(user)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, user.id))
    .where(eq(user.email, email));
  return { userId: row.userId, workspaceId: row.workspaceId, workspaceRole: row.role, actorType: "user" };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function prep() {
  const romel = await ctxFor("romel@ensemble.local");
  const [project] = await db.select().from(projects).where(eq(projects.name, "Nikki Songs"));
  for (const [title, isrc] of [
    ["Glass Rivers", "USX9P2600001"],
    ["Paper Lanterns", "USX9P2600004"],
  ]) {
    await db.update(lyricWorks).set({ isrc }).where(and(eq(lyricWorks.projectId, project.id), eq(lyricWorks.title, title)));
  }
  const cats = await listCategories(db, romel);
  const marketing = cats.find((c) => c.name === "Marketing")!.id;
  for (const [date, amount, description] of [
    ["2026-10-16", "800.00", "Meta Ads, Glass Rivers launch"],
    ["2026-10-18", "250.00", "TikTok ads, Glass Rivers"],
  ]) {
    await createExpense(romel, { date, amount, description, categoryId: marketing, projectId: project.id });
  }
}

async function backdate() {
  const [link] = await db
    .select()
    .from(spotifyArtists)
    .innerJoin(projects, eq(projects.id, spotifyArtists.projectId))
    .where(and(eq(projects.name, "Nikki Songs"), isNull(spotifyArtists.unlinkedAt)));
  const a = link.spotify_artists;
  await db
    .insert(spotifySnapshots)
    .values({ workspaceId: a.workspaceId, projectId: a.projectId, entityType: "artist", entityId: a.id, capturedOn: daysAgo(8), followers: 11_950, popularity: 58 })
    .onConflictDoNothing();
}

(process.argv[2] === "backdate" ? backdate() : prep()).then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
