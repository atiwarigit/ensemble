import { and, desc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import {
  alertRules,
  notificationReads,
  notifications,
  s4aMetrics,
  spotifyArtists,
  spotifySnapshots,
  type AlertParams,
} from "@/db/schema/analytics";
import { projects } from "@/db/schema/tenancy";
import { recordAudit, recordSystemAudit } from "./audit";
import { requireProjectRole, visibleProjectIds } from "./access";
import { notFound, type ServiceContext } from "./context";

export type AlertKind = (typeof alertRules.$inferSelect)["kind"];

export const ALERT_KINDS: Record<AlertKind, { label: string; source: string; describe: (p: AlertParams) => string; defaults: AlertParams }> = {
  streams_change: {
    label: "Streams change",
    source: "Spotify for Artists CSV",
    describe: (p) => `Streams over the last ${p.days} days are up or down ${p.threshold}% or more on the ${p.days} days before`,
    defaults: { threshold: 50, days: 7 },
  },
  s4a_stale: {
    label: "Spotify for Artists data is stale",
    source: "Spotify for Artists CSV",
    describe: (p) => `No new Spotify for Artists export for ${p.days} days`,
    defaults: { days: 14 },
  },
  popularity_change: {
    label: "Popularity change",
    source: "Spotify Web API",
    describe: (p) => `Artist popularity moves ${p.threshold} points or more in ${p.days} days`,
    defaults: { threshold: 5, days: 7 },
  },
  follower_milestone: {
    label: "Follower milestone",
    source: "Spotify Web API",
    describe: (p) => `Followers pass a multiple of ${(p.step ?? 1000).toLocaleString("en-US")}`,
    defaults: { step: 1000 },
  },
};

export async function ensureDefaultRules(exec: Executor, workspaceId: string, projectId: string, createdBy: string | null = null) {
  await exec
    .insert(alertRules)
    .values(
      (Object.keys(ALERT_KINDS) as AlertKind[]).map((kind) => ({
        workspaceId,
        projectId,
        kind,
        params: ALERT_KINDS[kind].defaults,
        createdBy,
      })),
    )
    .onConflictDoNothing();
}

export async function listAlertRules(exec: Executor, ctx: ServiceContext, projectId: string) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  const rows = await exec.select().from(alertRules).where(eq(alertRules.projectId, projectId));
  const order = Object.keys(ALERT_KINDS);
  return rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export const ruleInput = z.object({
  enabled: z.boolean(),
  threshold: z.coerce.number().int().min(1).max(1000).optional(),
  days: z.coerce.number().int().min(1).max(90).optional(),
  step: z.coerce.number().int().min(10).max(100_000_000).optional(),
});

export async function updateAlertRule(ctx: ServiceContext, ruleId: string, input: z.input<typeof ruleInput>) {
  const data = ruleInput.parse(input);
  return db.transaction(async (tx) => {
    const [rule] = await tx.select().from(alertRules).where(and(eq(alertRules.id, ruleId), eq(alertRules.workspaceId, ctx.workspaceId)));
    if (!rule) throw notFound("Alert not found.");
    await requireProjectRole(tx, ctx, rule.projectId, "lead");
    const params: AlertParams = { ...rule.params };
    for (const k of ["threshold", "days", "step"] as const) if (data[k] !== undefined && k in ALERT_KINDS[rule.kind].defaults) params[k] = data[k];
    await tx.update(alertRules).set({ enabled: data.enabled, params }).where(eq(alertRules.id, rule.id));
    await recordAudit(tx, ctx, {
      action: "alert.rule.updated",
      projectId: rule.projectId,
      entityType: "alert_rule",
      entityId: rule.id,
      before: { enabled: rule.enabled, params: rule.params },
      after: { kind: rule.kind, enabled: data.enabled, params },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Evaluation

const dayMinus = (day: string, n: number) => new Date(Date.parse(day) - n * 86_400_000).toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString("en-US");

type Fired = { kind: AlertKind; title: string; body: string; dedupeKey: string; data: Record<string, unknown> };

async function artistSnapshots(exec: Executor, projectId: string) {
  return exec
    .select({
      artistId: spotifySnapshots.entityId,
      name: spotifyArtists.name,
      day: spotifySnapshots.capturedOn,
      followers: spotifySnapshots.followers,
      popularity: spotifySnapshots.popularity,
    })
    .from(spotifySnapshots)
    .innerJoin(spotifyArtists, eq(spotifyArtists.id, spotifySnapshots.entityId))
    .where(and(eq(spotifySnapshots.projectId, projectId), eq(spotifySnapshots.entityType, "artist"), isNull(spotifyArtists.unlinkedAt)))
    .orderBy(spotifySnapshots.entityId, desc(spotifySnapshots.capturedOn));
}

/** Daily artist-level streams, falling back to the sum over songs when the export was per song. */
export async function dailyStreams(exec: Executor, projectId: string) {
  const rows = await exec
    .select({
      date: s4aMetrics.date,
      artist: sql<number | null>`sum(${s4aMetrics.value}) filter (where ${s4aMetrics.trackKey} = '')`.mapWith((v) => (v == null ? null : Number(v))),
      songs: sql<number>`coalesce(sum(${s4aMetrics.value}) filter (where ${s4aMetrics.trackKey} <> ''), 0)`.mapWith(Number),
    })
    .from(s4aMetrics)
    .where(and(eq(s4aMetrics.projectId, projectId), isNull(s4aMetrics.archivedAt), eq(s4aMetrics.metric, "streams")))
    .groupBy(s4aMetrics.date)
    .orderBy(s4aMetrics.date);
  return rows.map((r) => ({ date: r.date, value: r.artist ?? r.songs }));
}

async function evaluateRule(exec: Executor, rule: typeof alertRules.$inferSelect, today: string): Promise<Fired[]> {
  const p = rule.params;
  if (rule.kind === "popularity_change" || rule.kind === "follower_milestone") {
    const snaps = await artistSnapshots(exec, rule.projectId);
    const byArtist = new Map<string, typeof snaps>();
    for (const s of snaps) byArtist.set(s.artistId, [...(byArtist.get(s.artistId) ?? []), s]);
    const fired: Fired[] = [];
    for (const [artistId, list] of byArtist) {
      const latest = list[0];
      if (rule.kind === "popularity_change") {
        const days = p.days ?? 7;
        const threshold = p.threshold ?? 5;
        if (latest.popularity == null) continue;
        const base = list.find((s) => s.day <= dayMinus(latest.day, days) && s.popularity != null);
        if (!base) continue;
        const diff = latest.popularity - base.popularity!;
        if (Math.abs(diff) < threshold) continue;
        fired.push({
          kind: rule.kind,
          title: `${latest.name}: popularity ${diff < 0 ? "dropped" : "rose"} ${Math.abs(diff)} points`,
          body: `Spotify popularity went from ${base.popularity} on ${base.day} to ${latest.popularity} on ${latest.day} (Spotify Web API).`,
          dedupeKey: `pop:${rule.id}:${artistId}:${latest.day}`,
          data: { artistId, from: base.popularity, to: latest.popularity, fromDay: base.day, toDay: latest.day },
        });
      } else {
        const step = p.step ?? 1000;
        const prev = list.find((s) => s.day < latest.day && s.followers != null);
        if (latest.followers == null || !prev) continue;
        const crossed = Math.floor(latest.followers / step);
        if (crossed <= Math.floor(prev.followers! / step) || crossed === 0) continue;
        const milestone = crossed * step;
        fired.push({
          kind: rule.kind,
          title: `${latest.name} passed ${fmt(milestone)} followers`,
          body: `${fmt(latest.followers)} followers on ${latest.day}, up from ${fmt(prev.followers!)} on ${prev.day} (Spotify Web API).`,
          dedupeKey: `fol:${rule.id}:${artistId}:${milestone}`,
          data: { artistId, milestone, followers: latest.followers },
        });
      }
    }
    return fired;
  }

  if (rule.kind === "streams_change") {
    const days = p.days ?? 7;
    const threshold = p.threshold ?? 50;
    const series = await dailyStreams(exec, rule.projectId);
    if (series.length < days * 2) return [];
    const end = series[series.length - 1].date;
    const byDate = new Map(series.map((s) => [s.date, s.value]));
    let current = 0;
    let previous = 0;
    for (let i = 0; i < days; i++) {
      const a = byDate.get(dayMinus(end, i));
      const b = byDate.get(dayMinus(end, i + days));
      if (a === undefined || b === undefined) return [];
      current += a;
      previous += b;
    }
    if (previous === 0) return [];
    const pct = Math.round(((current - previous) / previous) * 100);
    if (Math.abs(pct) < threshold) return [];
    return [
      {
        kind: rule.kind,
        title: `Streams ${pct < 0 ? "down" : "up"} ${Math.abs(pct)}% week over week`,
        body: `${fmt(current)} streams in the ${days} days to ${end}, against ${fmt(previous)} the ${days} days before (Spotify for Artists CSV, as of ${end}).`,
        dedupeKey: `str:${rule.id}:${end}`,
        data: { current, previous, pct, end, days },
      },
    ];
  }

  // s4a_stale: only for projects with an artist linked, so unrelated projects stay quiet.
  const days = p.days ?? 14;
  const [link] = await exec
    .select({ linkedAt: spotifyArtists.linkedAt })
    .from(spotifyArtists)
    .where(and(eq(spotifyArtists.projectId, rule.projectId), isNull(spotifyArtists.unlinkedAt)))
    .orderBy(spotifyArtists.linkedAt)
    .limit(1);
  if (!link) return [];
  const [{ latest }] = await exec
    .select({ latest: sql<string | null>`max(${s4aMetrics.date})::text` })
    .from(s4aMetrics)
    .where(and(eq(s4aMetrics.projectId, rule.projectId), isNull(s4aMetrics.archivedAt)));
  const since = latest ?? link.linkedAt.toISOString().slice(0, 10);
  if (since > dayMinus(today, days)) return [];
  return [
    {
      kind: rule.kind,
      title: latest ? `Spotify for Artists data is ${Math.round((Date.parse(today) - Date.parse(latest)) / 86_400_000)} days old` : "No Spotify for Artists data yet",
      body: latest
        ? `The newest imported day is ${latest}. Export the audience timeline from Spotify for Artists and import it on the analytics page.`
        : "Streams and listeners only come from Spotify for Artists exports. Export the audience timeline and import it on the analytics page.",
      dedupeKey: `stale:${rule.id}:${latest ?? "none"}`,
      data: { latest },
    },
  ];
}

/** Evaluates every enabled rule (or one project's) and stores new notifications. Returns how many fired. */
export async function evaluateAlerts(opts: { projectIds?: string[]; now?: Date } = {}) {
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const rules = await db
    .select({ rule: alertRules })
    .from(alertRules)
    .innerJoin(projects, eq(projects.id, alertRules.projectId))
    .where(
      and(
        eq(alertRules.enabled, true),
        isNull(projects.archivedAt),
        opts.projectIds ? (opts.projectIds.length ? inArray(alertRules.projectId, opts.projectIds) : sql`false`) : undefined,
      ),
    );
  let fired = 0;
  for (const { rule } of rules) {
    for (const f of await evaluateRule(db, rule, today)) {
      const [n] = await db
        .insert(notifications)
        .values({
          workspaceId: rule.workspaceId,
          projectId: rule.projectId,
          alertRuleId: rule.id,
          kind: f.kind,
          title: f.title,
          body: f.body,
          href: `/analytics/${rule.projectId}`,
          data: f.data,
          dedupeKey: f.dedupeKey,
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      if (!n) continue;
      fired++;
      await db.update(alertRules).set({ lastFiredAt: new Date() }).where(eq(alertRules.id, rule.id));
      await recordSystemAudit(db, { workspaceId: rule.workspaceId }, {
        action: "alert.fired",
        projectId: rule.projectId,
        entityType: "notification",
        entityId: n.id,
        after: { kind: f.kind, title: f.title, ...f.data },
      });
    }
  }
  return fired;
}

/** Workspace-level notices (e.g. an audit-chain break), shown to owners and admins. */
export async function notifyWorkspace(exec: Executor, workspaceId: string, n: { kind: string; title: string; body: string; href?: string; dedupeKey: string; data?: unknown }) {
  const [row] = await exec
    .insert(notifications)
    .values({ workspaceId, projectId: null, kind: n.kind, title: n.title, body: n.body, href: n.href ?? null, dedupeKey: n.dedupeKey, data: n.data ?? null })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// Inbox

async function visibleCondition(exec: Executor, ctx: ServiceContext) {
  const ids = await visibleProjectIds(exec, ctx);
  const admin = ctx.workspaceRole === "owner" || ctx.workspaceRole === "admin";
  return and(
    eq(notifications.workspaceId, ctx.workspaceId),
    or(ids.length ? inArray(notifications.projectId, ids) : sql`false`, admin ? isNull(notifications.projectId) : sql`false`),
  )!;
}

const unread = (userId: string) =>
  notExists(
    db
      .select({ x: sql`1` })
      .from(notificationReads)
      .where(and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, userId))),
  );

export async function countUnread(exec: Executor, ctx: ServiceContext) {
  const [{ count }] = await exec
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(await visibleCondition(exec, ctx), unread(ctx.userId)));
  return count;
}

export async function listNotifications(exec: Executor, ctx: ServiceContext, opts: { limit?: number } = {}) {
  return exec
    .select({
      n: notifications,
      projectName: projects.name,
      readAt: notificationReads.readAt,
    })
    .from(notifications)
    .leftJoin(projects, eq(projects.id, notifications.projectId))
    .leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, ctx.userId)))
    .where(await visibleCondition(exec, ctx))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

export async function markNotificationsRead(ctx: ServiceContext, ids: string[] | "all") {
  const cond = await visibleCondition(db, ctx);
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(cond, unread(ctx.userId), ids === "all" ? undefined : ids.length ? inArray(notifications.id, ids) : sql`false`));
  if (rows.length) {
    await db
      .insert(notificationReads)
      .values(rows.map((r) => ({ notificationId: r.id, userId: ctx.userId })))
      .onConflictDoNothing();
  }
  return rows.length;
}
