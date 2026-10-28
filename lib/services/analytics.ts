import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { s4aMetrics, spotifyArtists, spotifySnapshots, spotifyTracks } from "@/db/schema/analytics";
import { lyricWorks } from "@/db/schema/lyrics";
import { projects } from "@/db/schema/tenancy";
import { S4A_METRIC_LABEL, type S4aMetric } from "@/lib/csv/s4a-csv";
import { formatMoney } from "@/lib/format";
import { dailyStreams } from "./alerts";
import { requireProjectRole, visibleProjectIds } from "./access";
import { listCategories, listExpenses, rollUpCategory } from "./expenses";
import { s4aTrackTotals } from "./s4a";
import type { ServiceContext } from "./context";

export const dayMinus = (day: string, n: number) => new Date(Date.parse(day) - n * 86_400_000).toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (current: number, previous: number) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

export const SOURCE = { webApi: "Spotify Web API (daily snapshot)", s4a: "Spotify for Artists CSV" } as const;

/** Projects the caller can see that have a linked artist or imported S4A data. */
export async function analyticsProjects(exec: Executor, ctx: ServiceContext) {
  const ids = await visibleProjectIds(exec, ctx);
  if (!ids.length) return [];
  const rows = await exec
    .select({
      id: projects.id,
      name: projects.name,
      type: projects.type,
      artists: sql<number>`(select count(*) from ${spotifyArtists} a where a.project_id = ${projects.id} and a.unlinked_at is null)`.mapWith(Number),
      artistNames: sql<string | null>`(select string_agg(a.name, ', ') from ${spotifyArtists} a where a.project_id = ${projects.id} and a.unlinked_at is null)`,
      snapshotAsOf: sql<string | null>`(select max(s.captured_on)::text from ${spotifySnapshots} s where s.project_id = ${projects.id})`,
      s4aAsOf: sql<string | null>`(select max(m.date)::text from ${s4aMetrics} m where m.project_id = ${projects.id} and m.archived_at is null)`,
    })
    .from(projects)
    .where(inArray(projects.id, ids))
    .orderBy(projects.name);
  return rows;
}

export type MetricWindow = { current: number; previous: number | null; change: number | null; from: string; to: string };

async function artistLevelSeries(exec: Executor, projectId: string, metric: S4aMetric) {
  if (metric === "streams") return dailyStreams(exec, projectId);
  return exec
    .select({ date: s4aMetrics.date, value: s4aMetrics.value })
    .from(s4aMetrics)
    .where(and(eq(s4aMetrics.projectId, projectId), isNull(s4aMetrics.archivedAt), eq(s4aMetrics.metric, metric), eq(s4aMetrics.trackKey, "")))
    .orderBy(s4aMetrics.date);
}

/**
 * Streams, saves and playlist adds are summed over the window; listeners are averaged per day
 * (they're daily uniques, so they don't add up); followers compare the last day with the day before
 * the window.
 */
function windowed(series: { date: string; value: number }[], metric: S4aMetric, days: number): MetricWindow | null {
  if (!series.length) return null;
  const to = series[series.length - 1].date;
  const from = dayMinus(to, days - 1);
  const prevFrom = dayMinus(from, days);
  const inRange = (a: string, b: string) => series.filter((s) => s.date >= a && s.date <= b);
  const cur = inRange(from, to);
  const prev = inRange(prevFrom, dayMinus(from, 1));
  const agg = (xs: typeof series) =>
    metric === "followers" ? (xs.at(-1)?.value ?? 0) : metric === "listeners" ? xs.reduce((s, x) => s + x.value, 0) / Math.max(xs.length, 1) : xs.reduce((s, x) => s + x.value, 0);
  const current = agg(cur);
  const complete = prev.length >= Math.ceil(days * 0.8);
  const previous = complete ? agg(prev) : null;
  return { current, previous, change: previous === null ? null : pct(current, previous), from, to };
}

export async function getTrends(exec: Executor, ctx: ServiceContext, projectId: string, days = 28) {
  const { project } = await requireProjectRole(exec, ctx, projectId, "viewer");
  const snaps = await exec
    .select({ day: spotifySnapshots.capturedOn, followers: spotifySnapshots.followers, popularity: spotifySnapshots.popularity, name: spotifyArtists.name })
    .from(spotifySnapshots)
    .innerJoin(spotifyArtists, eq(spotifyArtists.id, spotifySnapshots.entityId))
    .where(and(eq(spotifySnapshots.projectId, projectId), eq(spotifySnapshots.entityType, "artist"), isNull(spotifyArtists.unlinkedAt)))
    .orderBy(spotifySnapshots.capturedOn);
  const latest = snaps.at(-1) ?? null;
  const base = latest ? ([...snaps].reverse().find((s) => s.day <= dayMinus(latest.day, days)) ?? snaps[0]) : null;
  const delta = (k: "followers" | "popularity") =>
    latest && latest[k] != null && base && base[k] != null ? { start: base[k]!, end: latest[k]!, startDay: base.day, change: latest[k]! - base[k]! } : null;

  const s4a: Partial<Record<S4aMetric, MetricWindow>> = {};
  let s4aAsOf: string | null = null;
  for (const metric of ["streams", "listeners", "saves", "followers"] as const) {
    const w = windowed(await artistLevelSeries(exec, projectId, metric), metric, days);
    if (!w) continue;
    s4a[metric] = w;
    if (!s4aAsOf || w.to > s4aAsOf) s4aAsOf = w.to;
  }
  return {
    project: { id: project.id, name: project.name },
    days,
    webApi: latest
      ? { source: SOURCE.webApi, asOf: latest.day, artist: latest.name, followers: delta("followers"), popularity: delta("popularity"), snapshots: snaps.length }
      : null,
    s4a: s4aAsOf ? { source: SOURCE.s4a, asOf: s4aAsOf, metrics: s4a } : null,
  };
}

export function describeTrends(t: Awaited<ReturnType<typeof getTrends>>) {
  const parts: string[] = [];
  if (t.s4a) {
    const m = t.s4a.metrics;
    const bits = (Object.keys(m) as S4aMetric[]).map((k) => {
      const w = m[k]!;
      const label = k === "listeners" ? "listeners/day" : S4A_METRIC_LABEL[k].toLowerCase();
      return `${fmt(w.current)} ${label}${w.change !== null ? ` (${w.change >= 0 ? "+" : ""}${w.change}% vs the ${t.days} days before)` : ""}`;
    });
    parts.push(`Last ${t.days} days to ${t.s4a.asOf}: ${bits.join(", ")} [${SOURCE.s4a}, as of ${t.s4a.asOf}].`);
  } else {
    parts.push("No Spotify for Artists data imported yet, so there are no streams or listeners.");
  }
  if (t.webApi) {
    const f = t.webApi.followers;
    const p = t.webApi.popularity;
    if (f || p) {
      const bits = [
        f && `${fmt(f.end)} followers (${f.change >= 0 ? "+" : ""}${fmt(f.change)} since ${f.startDay})`,
        p && `popularity ${p.end} (${p.change >= 0 ? "+" : ""}${p.change})`,
      ].filter(Boolean);
      parts.push(`${t.webApi.artist}: ${bits.join(", ")} [${SOURCE.webApi}, as of ${t.webApi.asOf}].`);
    } else {
      parts.push(`Spotify doesn't share followers or popularity with this app (Development Mode); the daily snapshot as of ${t.webApi.asOf} tracks the catalogue only.`);
    }
  }
  return parts.join(" ");
}

export async function compareTracks(exec: Executor, ctx: ServiceContext, projectId: string, opts: { days?: number; metric?: S4aMetric } = {}) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  const days = opts.days ?? 28;
  const metric = opts.metric ?? "streams";
  const [{ asOf }] = await exec
    .select({ asOf: sql<string | null>`max(${s4aMetrics.date})::text` })
    .from(s4aMetrics)
    .where(and(eq(s4aMetrics.projectId, projectId), isNull(s4aMetrics.archivedAt), eq(s4aMetrics.metric, metric), sql`${s4aMetrics.trackKey} <> ''`));
  if (!asOf) return { asOf: null, days, metric, rows: [] };
  const from = dayMinus(asOf, days - 1);
  const [cur, prev] = await Promise.all([
    s4aTrackTotals(exec, ctx, projectId, { metric, from, to: asOf }),
    s4aTrackTotals(exec, ctx, projectId, { metric, from: dayMinus(from, days), to: dayMinus(from, 1) }),
  ]);
  const prevBy = new Map(prev.map((p) => [p.trackKey, p.total]));
  const trackIds = cur.map((c) => c.trackId).filter((x): x is string => !!x);
  const meta = trackIds.length
    ? await exec
        .select({ id: spotifyTracks.id, isrc: spotifyTracks.isrc, releaseDate: spotifyTracks.releaseDate, workId: lyricWorks.id, workTitle: lyricWorks.title })
        .from(spotifyTracks)
        .leftJoin(lyricWorks, and(eq(lyricWorks.projectId, spotifyTracks.projectId), sql`upper(${lyricWorks.isrc}) = upper(${spotifyTracks.isrc})`))
        .where(inArray(spotifyTracks.id, trackIds))
    : [];
  const metaBy = new Map(meta.map((m) => [m.id, m]));
  return {
    asOf,
    days,
    metric,
    rows: cur.map((c) => {
      const m = c.trackId ? metaBy.get(c.trackId) : undefined;
      const previous = prevBy.get(c.trackKey) ?? null;
      return {
        trackKey: c.trackKey,
        name: c.trackName,
        total: c.total,
        previous,
        change: previous !== null ? pct(c.total, previous) : null,
        releaseDate: m?.releaseDate ?? null,
        isrc: m?.isrc ?? null,
        work: m?.workId ? { id: m.workId, title: m.workTitle! } : null,
      };
    }),
  };
}

/**
 * Finds the change in a metric over the last `days` vs the `days` before, and lists what else
 * happened in that time: releases (from the catalogue snapshot) and marketing spend (from
 * expenses). It reports coincidences only; it never claims a cause.
 */
export async function explainChange(exec: Executor, ctx: ServiceContext, projectId: string, opts: { days?: number; metric?: S4aMetric } = {}) {
  const { project } = await requireProjectRole(exec, ctx, projectId, "viewer");
  const days = opts.days ?? 7;
  const metric = opts.metric ?? "streams";
  const w = windowed(await artistLevelSeries(exec, projectId, metric), metric, days);
  if (!w) return { project: project.name, metric, days, window: null, releases: [], marketing: [], marketingMinor: 0 };
  const lookFrom = dayMinus(w.from, days);

  const releases = await exec
    .selectDistinct({ album: spotifyTracks.albumName, type: spotifyTracks.albumType, date: spotifyTracks.releaseDate })
    .from(spotifyTracks)
    .innerJoin(spotifyArtists, eq(spotifyArtists.id, spotifyTracks.artistLinkId))
    .where(and(eq(spotifyTracks.projectId, projectId), isNull(spotifyArtists.unlinkedAt), gte(spotifyTracks.releaseDate, lookFrom), lte(spotifyTracks.releaseDate, w.to)))
    .orderBy(spotifyTracks.releaseDate);

  const [{ rows }, categories] = await Promise.all([
    listExpenses(exec, ctx, { projectId, from: lookFrom, to: w.to }, 200),
    listCategories(exec, ctx),
  ]);
  const marketing = rows
    .map((r) => ({ ...r.expense, top: rollUpCategory(categories, r.expense.categoryId).name }))
    .filter((e) => e.top === "Marketing")
    .map((e) => ({ date: e.date, merchant: e.merchant ?? e.description, amountMinor: e.amountMinor, currency: e.currency }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    project: project.name,
    metric,
    days,
    window: w,
    releases,
    marketing,
    marketingMinor: marketing.reduce((s, m) => s + m.amountMinor, 0),
  };
}

export function describeExplain(e: Awaited<ReturnType<typeof explainChange>>) {
  const label = S4A_METRIC_LABEL[e.metric].toLowerCase();
  if (!e.window) return `There's no Spotify for Artists ${label} data for ${e.project} yet. Import an export first.`;
  const w = e.window;
  const head =
    w.change === null
      ? `${fmt(w.current)} ${label} from ${w.from} to ${w.to}; there isn't enough earlier data to compare.`
      : `${S4A_METRIC_LABEL[e.metric]} ${w.change >= 0 ? "rose" : "fell"} ${Math.abs(w.change)}%: ${fmt(w.current)} from ${w.from} to ${w.to}, against ${fmt(w.previous!)} the ${e.days} days before [${SOURCE.s4a}, as of ${w.to}].`;
  const events: string[] = [];
  for (const r of e.releases) events.push(`${r.type === "single" ? "single" : r.type} “${r.album}” released ${r.date}`);
  if (e.marketing.length) {
    const top = e.marketing
      .slice(0, 4)
      .map((m) => `${m.merchant} ${formatMoney(m.amountMinor)} on ${m.date}`)
      .join(", ");
    events.push(`${formatMoney(e.marketingMinor)} of marketing spend (${top}${e.marketing.length > 4 ? ", …" : ""})`);
  }
  const tail = events.length
    ? ` Around the same time: ${events.join("; ")}. These coincide with the change; the data can't show what caused it.`
    : " No releases or marketing spend were recorded in that period.";
  return head + tail;
}

export async function latestTracksWithWorks(exec: Executor, ctx: ServiceContext, projectId: string) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  return exec
    .select({ trackId: spotifyTracks.id, workId: lyricWorks.id, workTitle: lyricWorks.title })
    .from(spotifyTracks)
    .innerJoin(lyricWorks, and(eq(lyricWorks.projectId, spotifyTracks.projectId), sql`upper(${lyricWorks.isrc}) = upper(${spotifyTracks.isrc})`))
    .where(eq(spotifyTracks.projectId, projectId))
    .orderBy(desc(spotifyTracks.releaseDate));
}
