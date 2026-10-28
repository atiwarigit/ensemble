import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { alertRules, jobRuns, notifications, rateLimits, s4aMetrics, spotifyArtists, spotifySnapshots, spotifyTracks } from "@/db/schema/analytics";
import { auditEvents } from "@/db/schema/audit";
import { session } from "@/db/schema/auth";
import { importBatches } from "@/db/schema/expenses";
import { lyricWorks } from "@/db/schema/lyrics";
import { planCommand } from "@/lib/agents/commands";
import { resolveTool, runTool } from "@/lib/agents/registry";
import { guessS4aConfig, matchTrack, parseCount } from "@/lib/csv/s4a-csv";
import { parseCsv } from "@/lib/csv/expenses-csv";
import { runAuditVerifyJob, runRetentionJob, runSpotifyJob } from "@/lib/jobs";
import { hitRateLimit, LIMITS, peekRateLimit } from "@/lib/rate-limit";
import { countUnread, evaluateAlerts, listNotifications, markNotificationsRead } from "@/lib/services/alerts";
import { decideApproval, requestApproval } from "@/lib/services/approvals";
import { recordAudit } from "@/lib/services/audit";
import type { ServiceContext } from "@/lib/services/context";
import { createExpense, listCategories, seedDefaultCategories } from "@/lib/services/expenses";
import { createProject, setProjectMember } from "@/lib/services/projects";
import { commitS4aImport, createS4aImport, getS4aPreview, updateS4aConfig } from "@/lib/services/s4a";
import { runSpotifySnapshot } from "@/lib/services/spotify";
import { createSpotifyClient, parseSpotifyId, resetSpotifyTokenCache, spotifyConfig, SpotifyError } from "@/lib/spotify/client";
import { GET as cronRetention } from "@/app/api/cron/retention/route";
import { GET as cronSpotify } from "@/app/api/cron/spotify/route";
import { createMockSpotifyServer, XANIA_ID } from "../mocks/spotify-server.mjs";
import { createMember, createWorkspace } from "./fixtures";

const server = createMockSpotifyServer();
let base = "";
const control = (body: unknown) => fetch(`${base}/__control`, { method: "POST", body: JSON.stringify(body) });
const calls = async () => (await (await fetch(`${base}/__calls`)).json()) as Record<string, number>;
const noSleep = { sleep: async () => {} };
const sample = (name: string) => new Uint8Array(readFileSync(`samples/s4a/${name}`));

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});
beforeEach(async () => {
  await fetch(`${base}/__reset`, { method: "POST" });
  resetSpotifyTokenCache();
  process.env.SPOTIFY_CLIENT_ID = "mock-client";
  process.env.SPOTIFY_CLIENT_SECRET = "mock-secret";
  process.env.SPOTIFY_API_BASE = base;
  process.env.SPOTIFY_ACCOUNTS_BASE = base;
  // Only this file's artists should be snapshotted by the cron-style runs below.
  await db.update(spotifyArtists).set({ unlinkedAt: new Date() }).where(isNull(spotifyArtists.unlinkedAt));
});

async function setup() {
  const ws = await createWorkspace();
  await seedDefaultCategories(db, ws.id);
  const owner = await createMember(ws.id, "owner", "Romel");
  const nikki = await createMember(ws.id, "member", "Nikki");
  const viewer = await createMember(ws.id, "member", "Viewer");
  const outsider = await createMember(ws.id, "member", "Outsider");
  const project = await createProject(owner, { name: "Xania", type: "artist" });
  await setProjectMember(owner, project.id, { userId: nikki.userId, role: "lead" });
  await setProjectMember(owner, project.id, { userId: viewer.userId, role: "viewer" });
  return { ws, owner, nikki, viewer, outsider, project };
}

async function linkXania(owner: ServiceContext, requester: ServiceContext, projectId: string) {
  const req = await requestApproval(requester, "spotify.connect", { projectId, spotifyArtistId: XANIA_ID, name: "Xania" });
  const done = await decideApproval(owner, req.id, { decision: "approve" });
  expect(done.status).toBe("executed");
  const [link] = await db.select().from(spotifyArtists).where(and(eq(spotifyArtists.projectId, projectId), isNull(spotifyArtists.unlinkedAt)));
  return link;
}

describe("Spotify parsing", () => {
  it("accepts artist links, URIs and IDs", () => {
    expect(parseSpotifyId(`https://open.spotify.com/artist/${XANIA_ID}?si=abc`, "artist")).toBe(XANIA_ID);
    expect(parseSpotifyId(`https://open.spotify.com/intl-de/artist/${XANIA_ID}`, "artist")).toBe(XANIA_ID);
    expect(parseSpotifyId(`spotify:artist:${XANIA_ID}`, "artist")).toBe(XANIA_ID);
    expect(parseSpotifyId(XANIA_ID, "artist")).toBe(XANIA_ID);
    expect(parseSpotifyId(`https://open.spotify.com/track/${XANIA_ID}`, "artist")).toBeNull();
    expect(parseSpotifyId("https://evil.example/artist/3XaniaMockArtistId0001", "artist")).toBeNull();
  });

  it("detects the three Spotify for Artists export shapes", () => {
    const timeline = parseCsv(readFileSync("samples/s4a/xania-audience-timeline.csv", "utf8"));
    expect(guessS4aConfig(timeline.headers, timeline.rows)).toMatchObject({
      dateColumn: "date",
      dateFormat: "YYYY-MM-DD",
      trackColumn: null,
      metrics: { listeners: "listeners", streams: "streams", followers: "followers" },
    });
    const songs = parseCsv(readFileSync("samples/s4a/xania-songs-28-days.csv", "utf8"));
    expect(guessS4aConfig(songs.headers, songs.rows)).toMatchObject({ dateColumn: null, trackColumn: "song", metrics: { streams: "streams", saves: "saves" } });
    expect(parseCount("12,480")).toBe(12480);
    expect(parseCount("")).toBeNull();
    expect(parseCount("abc")).toBeNaN();
    const tracks = [
      { id: "a", spotifyTrackId: "XaniaTrackGlassRivers1", isrc: "USX9P2600001", name: "Glass Rivers" },
      { id: "b", spotifyTrackId: "XaniaTrackNeonSaints01", isrc: "USX9P2600002", name: "Neon Saints" },
    ];
    expect(matchTrack("US-X9P-26-00002", tracks)?.id).toBe("b");
    expect(matchTrack("spotify:track:XaniaTrackGlassRivers1", tracks)?.id).toBe("a");
    expect(matchTrack("glass rivers", tracks)?.id).toBe("a");
    expect(matchTrack("Unknown", tracks)).toBeNull();
  });
});

describe("Spotify client (mocked Web API)", () => {
  it("omits followers and popularity in Development Mode and returns them in extended mode", async () => {
    const client = createSpotifyClient(spotifyConfig()!, noSleep);
    const dev = await client.getArtist(XANIA_ID);
    expect(dev.name).toBe("Xania");
    expect(dev.followers).toBeUndefined();
    expect(dev.popularity).toBeUndefined();
    expect((await client.getTrack("XaniaTrackGlassRivers1")).external_ids?.isrc).toBe("USX9P2600001");
    await control({ mode: "extended" });
    expect(await client.getArtist(XANIA_ID)).toMatchObject({ followers: { total: 12480 }, popularity: 52 });
  });

  it("waits for Retry-After on 429, backs off on 5xx, and caches the token", async () => {
    const slept: number[] = [];
    const client = createSpotifyClient(spotifyConfig()!, { sleep: async (ms) => void slept.push(ms) });
    await control({ rateLimit: 2 });
    await client.getArtist(XANIA_ID);
    expect(slept).toEqual([1000, 1000]);
    await control({ serverError: 1 });
    await client.getArtist(XANIA_ID);
    expect(slept).toEqual([1000, 1000, 500]);
    expect(client.stats.retries).toBe(3);
    await createSpotifyClient(spotifyConfig()!, noSleep).getArtist(XANIA_ID);
    expect((await calls()).token).toBe(1);
  });

  it("never retries a quota 429 and reports bad credentials", async () => {
    await control({ quotaExceeded: true });
    const err = await createSpotifyClient(spotifyConfig()!, noSleep).getArtist(XANIA_ID).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyError);
    expect(err.quotaExceeded).toBe(true);
    expect((await calls()).artist ?? 0).toBe(0);
    resetSpotifyTokenCache();
    const bad = await createSpotifyClient({ ...spotifyConfig()!, clientSecret: "wrong" }, noSleep).getArtist(XANIA_ID).catch((e) => e);
    expect(bad.message).toMatch(/client credentials/);
  });
});

describe("linking and the daily snapshot", () => {
  it("linking needs an owner's approval; viewers can't request it", async () => {
    const { owner, nikki, viewer, project } = await setup();
    await expect(requestApproval(viewer, "spotify.connect", { projectId: project.id, spotifyArtistId: XANIA_ID, name: "Xania" })).rejects.toThrow();
    const req = await requestApproval(nikki, "spotify.connect", { projectId: project.id, spotifyArtistId: XANIA_ID, name: "Xania" });
    expect(req.requiredRole).toBe("owner");
    await expect(decideApproval(nikki, req.id, { decision: "approve" })).rejects.toThrow(/owner/);
    await decideApproval(owner, req.id, { decision: "approve" });
    const rules = await db.select().from(alertRules).where(eq(alertRules.projectId, project.id));
    expect(rules.map((r) => r.kind).sort()).toEqual(["follower_milestone", "popularity_change", "s4a_stale", "streams_change"]);
    const events = await db.select().from(auditEvents).where(and(eq(auditEvents.projectId, project.id), eq(auditEvents.action, "spotify.artist.linked")));
    expect(events).toHaveLength(1);
    await expect(requestApproval(nikki, "spotify.connect", { projectId: project.id, spotifyArtistId: XANIA_ID, name: "Xania" })).rejects.toThrow(/already linked/);
  });

  it("captures the catalogue with ISRCs in Development Mode and fetches each track only once", async () => {
    const { owner, nikki, project } = await setup();
    const link = await linkXania(owner, nikki, project.id);
    const r1 = await runSpotifySnapshot({ trigger: "cron", ...noSleep, now: new Date("2026-10-20T06:00:00Z") });
    expect(r1).toMatchObject({ status: "ok", artists: 1, tracks: 4, fields: { followers: false, popularity: false } });
    const tracks = await db.select().from(spotifyTracks).where(eq(spotifyTracks.artistLinkId, link.id));
    expect(tracks.map((t) => t.isrc).sort()).toEqual(["USX9P2600001", "USX9P2600002", "USX9P2600003", "USX9P2600004"]);
    const [snap] = await db.select().from(spotifySnapshots).where(eq(spotifySnapshots.entityId, link.id));
    expect(snap).toMatchObject({ followers: null, popularity: null, capturedOn: "2026-10-20" });
    expect((await calls()).track).toBe(4);
    await runSpotifySnapshot({ trigger: "cron", ...noSleep, now: new Date("2026-10-21T06:00:00Z") });
    expect((await calls()).track).toBe(4);
    await runSpotifySnapshot({ trigger: "manual", projectId: project.id, ...noSleep, now: new Date("2026-10-21T09:00:00Z") });
    expect(await db.select().from(spotifySnapshots).where(eq(spotifySnapshots.entityId, link.id))).toHaveLength(2);
  });

  it("records followers and popularity in extended mode and alerts on a popularity drop", async () => {
    const { owner, nikki, project } = await setup();
    await linkXania(owner, nikki, project.id);
    await control({ mode: "extended" });
    await runSpotifyJob({ now: new Date("2026-10-10T06:00:00Z"), ...noSleep });
    await control({ artist: { popularity: 45, followers: 13_020 } });
    const job = await runSpotifyJob({ now: new Date("2026-10-17T06:00:00Z"), ...noSleep });
    expect(job.ok).toBe(true);
    const notes = await db.select().from(notifications).where(eq(notifications.projectId, project.id));
    expect(notes.map((n) => n.title).sort()).toEqual(["Xania passed 13,000 followers", "Xania: popularity dropped 7 points"]);
    expect(await countUnread(db, nikki)).toBe(2);
    await runSpotifyJob({ now: new Date("2026-10-17T07:00:00Z"), ...noSleep });
    expect(await db.select().from(notifications).where(eq(notifications.projectId, project.id))).toHaveLength(2);
  });

  it("stops on a quota error and records it on the run", async () => {
    const { owner, nikki, project } = await setup();
    await linkXania(owner, nikki, project.id);
    await control({ quotaExceeded: true });
    const r = await runSpotifySnapshot({ trigger: "cron", ...noSleep });
    expect(r.status).toBe("error");
    expect(r.errors[0]).toMatch(/429/);
  });
});

describe("Spotify for Artists CSV import", () => {
  it("imports the audience timeline, skips days already imported, and fires the streams alert", async () => {
    const { owner, nikki, viewer, project } = await setup();
    await linkXania(owner, nikki, project.id);
    await expect(createS4aImport(viewer, { filename: "t.csv", bytes: sample("xania-audience-timeline.csv"), projectId: project.id })).rejects.toThrow();
    const batch = await createS4aImport(nikki, { filename: "xania-audience-timeline.csv", bytes: sample("xania-audience-timeline.csv"), projectId: project.id });
    const { preview } = await getS4aPreview(db, nikki, batch.id);
    expect(preview!.totals).toMatchObject({ rows: 83, points: 249, toImport: 249, duplicates: 0, errors: 0 });
    expect(preview!.dateRange).toEqual({ from: "2026-08-01", to: "2026-10-22" });
    const committed = await commitS4aImport(nikki, batch.id);
    expect(committed.inserted).toBe(249);
    expect(await evaluateAlerts({ projectIds: [project.id], now: new Date("2026-10-28T06:00:00Z") })).toBe(1);
    const [note] = await listNotifications(db, viewer);
    expect(note.n.title).toMatch(/^Streams up \d+% week over week$/);
    expect(note.n.body).toContain("Spotify for Artists CSV, as of 2026-10-22");

    const again = await createS4aImport(nikki, { filename: "again.csv", bytes: sample("xania-audience-timeline.csv"), projectId: project.id });
    const p2 = (await getS4aPreview(db, nikki, again.id)).preview!;
    expect(p2.totals).toMatchObject({ toImport: 0, duplicates: 249 });
  });

  it("maps a period summary to songs by name, with a fixed end date", async () => {
    const { owner, nikki, project } = await setup();
    await linkXania(owner, nikki, project.id);
    await runSpotifySnapshot({ trigger: "manual", projectId: project.id, ...noSleep });
    const batch = await createS4aImport(nikki, { filename: "songs.csv", bytes: sample("xania-songs-28-days.csv"), projectId: project.id });
    expect((await getS4aPreview(db, nikki, batch.id)).preview!.configError).toMatch(/date/);
    await updateS4aConfig(nikki, batch.id, {
      dateColumn: null,
      dateFormat: "YYYY-MM-DD",
      fixedDate: "2026-10-22",
      trackColumn: "song",
      fixedTrackId: null,
      metrics: { streams: "streams", listeners: "listeners", saves: "saves" },
    });
    const preview = (await getS4aPreview(db, nikki, batch.id)).preview!;
    expect(preview.unmatchedSongs).toEqual([]);
    expect(preview.points.filter((p) => p.metric === "streams").map((p) => p.trackName)).toEqual(["Glass Rivers", "Neon Saints", "Undertow", "Paper Lanterns"]);
    await commitS4aImport(nikki, batch.id);
    const rows = await db.select().from(s4aMetrics).where(and(eq(s4aMetrics.importBatchId, batch.id), eq(s4aMetrics.metric, "streams")));
    expect(rows.every((r) => r.trackId && r.trackKey === `t:${r.trackId}`)).toBe(true);
  });

  it("files over 500 rows need an approval, and reverts archive the data points", async () => {
    const { owner, nikki, project } = await setup();
    const lines = ["date,streams"];
    for (let i = 0; i < 520; i++) lines.push(`${new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)},${100 + i}`);
    const bytes = new TextEncoder().encode(lines.join("\n"));
    const batch = await createS4aImport(nikki, { filename: "big.csv", bytes, projectId: project.id });
    await expect(commitS4aImport(nikki, batch.id)).rejects.toThrow(/need an approval/);
    const req = await requestApproval(nikki, "import.commit_large", { batchId: batch.id });
    expect(req.summary).toMatch(/Import 520 Spotify for Artists data points/);
    expect((await decideApproval(owner, req.id, { decision: "approve" })).status).toBe("executed");
    const revert = await requestApproval(nikki, "import.revert", { batchId: batch.id });
    expect(revert.summary).toContain("520 Spotify for Artists data points");
    await decideApproval(owner, revert.id, { decision: "approve" });
    const left = await db.select().from(s4aMetrics).where(and(eq(s4aMetrics.importBatchId, batch.id), isNull(s4aMetrics.archivedAt)));
    expect(left).toHaveLength(0);
    const [b] = await db.select().from(importBatches).where(eq(importBatches.id, batch.id));
    expect(b.status).toBe("reverted");
  });
});

describe("Analytics agent", () => {
  async function withData() {
    const s = await setup();
    await linkXania(s.owner, s.nikki, s.project.id);
    await runSpotifySnapshot({ trigger: "manual", projectId: s.project.id, ...noSleep });
    const b = await createS4aImport(s.nikki, { filename: "t.csv", bytes: sample("xania-audience-timeline.csv"), projectId: s.project.id });
    await commitS4aImport(s.nikki, b.id);
    const marketing = (await listCategories(db, s.owner)).find((c) => c.name === "Marketing")!;
    await createExpense(s.owner, {
      date: "2026-10-16",
      amount: "800.00",
      currency: "USD",
      merchant: "Meta Ads",
      description: "Glass Rivers launch",
      categoryId: marketing.id,
      projectId: s.project.id,
    });
    return s;
  }
  const tc = (ctx: ServiceContext, projectId: string | null) => ({ ctx: { ...ctx, actorType: "agent" as const }, projectId, threadId: randomUUID(), mode: "commands" as const, llm: null });

  it("getTrends cites the source and as-of date, and says what Spotify doesn't share", async () => {
    const { nikki, project } = await withData();
    const run = await runTool(tc(nikki, project.id), resolveTool("analytics_getTrends")!, { days: 28 });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.result.summary).toContain("[Spotify for Artists CSV, as of 2026-10-22]");
    expect(run.result.summary).toContain("Development Mode");
  });

  it("explainChange lists the release and marketing spend without claiming a cause", async () => {
    const { nikki, project } = await withData();
    const run = await runTool(tc(nikki, project.id), resolveTool("analytics_explainChange")!, {});
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.result.summary).toMatch(/Streams rose \d+%/);
    expect(run.result.summary).toContain("album “Glass Rivers” released 2026-10-17");
    expect(run.result.summary).toContain("$800.00 of marketing spend (Meta Ads $800.00 on 2026-10-16)");
    expect(run.result.summary).toContain("can't show what caused it");
  });

  it("compareTracks ranks songs and links lyrics by ISRC; outsiders get nothing", async () => {
    const { owner, nikki, outsider, project } = await withData();
    await db.insert(lyricWorks).values({ workspaceId: owner.workspaceId, projectId: project.id, title: "Glass Rivers", isrc: "USX9P2600001", createdBy: nikki.userId });
    for (const [date, a, b] of [["2026-10-21", 900, 300], ["2026-10-22", 950, 280]] as const) {
      await db.insert(s4aMetrics).values([
        { workspaceId: owner.workspaceId, projectId: project.id, date, trackKey: "n:glass", trackName: "Glass Rivers", metric: "streams", value: a, importBatchId: (await db.select().from(importBatches).where(eq(importBatches.projectId, project.id)))[0].id },
        { workspaceId: owner.workspaceId, projectId: project.id, date, trackKey: "n:neon", trackName: "Neon Saints", metric: "streams", value: b, importBatchId: (await db.select().from(importBatches).where(eq(importBatches.projectId, project.id)))[0].id },
      ]);
    }
    const run = await runTool(tc(nikki, project.id), resolveTool("analytics_compareTracks")!, { days: 7 });
    expect(run.ok && run.result.summary).toMatch(/1\. Glass Rivers 1,850; 2\. Neon Saints 580/);
    const denied = await runTool(tc(outsider, null), resolveTool("analytics_getTrends")!, { project: "Xania" });
    expect(denied).toMatchObject({ ok: false });
  });

  it("commands route streaming questions to the Analytics agent", () => {
    expect(planCommand("/streams 28")).toMatchObject({ calls: [{ tool: "analytics_getTrends", input: { days: 28 } }] });
    expect(planCommand("/why")).toMatchObject({ calls: [{ tool: "analytics_explainChange" }] });
    expect(planCommand("why did streams jump last week?")).toMatchObject({ calls: [{ tool: "analytics_explainChange" }] });
    expect(planCommand("which songs have the most streams")).toMatchObject({ calls: [{ tool: "analytics_compareTracks" }] });
    const both = planCommand("what did we spend in october and how are streams doing");
    expect(both.kind === "calls" && both.calls.map((c) => c.tool)).toEqual(["finance_summarizeSpend", "analytics_getTrends"]);
  });
});

describe("hardening", () => {
  it("cron routes require the CRON_SECRET bearer token", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    expect((await cronRetention(new Request("http://x/api/cron/retention"))).status).toBe(401);
    expect((await cronRetention(new Request("http://x/api/cron/retention", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    const ok = await cronRetention(new Request("http://x/api/cron/retention", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(ok.status).toBe(200);
    const spotify = await cronSpotify(new Request("http://x/api/cron/spotify", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(spotify.status).toBe(200);
    delete process.env.CRON_SECRET;
    expect((await cronRetention(new Request("http://x/api/cron/retention", { headers: { authorization: "Bearer test-cron-secret" } }))).status).toBe(503);
  });

  it("rate limits count per window", async () => {
    const key = `test:${randomUUID()}`;
    const limit = { limit: 3, windowSec: 60 };
    const now = Date.UTC(2026, 9, 28, 12, 0, 10);
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await hitRateLimit(key, limit, now)).ok);
    expect(results).toEqual([true, true, true, false]);
    expect((await peekRateLimit(key, limit, now)).ok).toBe(false);
    expect((await hitRateLimit(key, limit, now + 60_000)).ok).toBe(true);
    expect(LIMITS.chatPerUser).toEqual({ limit: 30, windowSec: 300 });
  });

  it("retention removes abandoned previews, old rate-limit windows and expired sessions, but no audit events", async () => {
    const { nikki, project } = await setup();
    const batch = await createS4aImport(nikki, { filename: "old.csv", bytes: sample("glass-rivers-timeline.csv"), projectId: project.id });
    await db.update(importBatches).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(importBatches.id, batch.id));
    await db.insert(rateLimits).values({ key: "old", windowStart: new Date(Date.now() - 3 * 86_400_000), count: 4 });
    await db.insert(session).values({ id: randomUUID(), token: randomUUID(), userId: nikki.userId, expiresAt: new Date(Date.now() - 1000), createdAt: new Date(), updatedAt: new Date() });
    const [{ before }] = await db.select({ before: sql<number>`count(*)::int` }).from(auditEvents);
    const r = await runRetentionJob();
    expect(r.ok).toBe(true);
    expect(r.abandonedImports).toBeGreaterThanOrEqual(1);
    expect(r.rateLimitWindows).toBeGreaterThanOrEqual(1);
    expect(r.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(importBatches).where(eq(importBatches.id, batch.id))).toHaveLength(0);
    const [{ after }] = await db.select({ after: sql<number>`count(*)::int` }).from(auditEvents);
    expect(after).toBeGreaterThan(before);
    const [run] = await db.select().from(jobRuns).where(eq(jobRuns.job, "retention")).orderBy(sql`started_at desc`).limit(1);
    expect(run.ok).toBe(true);
  });

  it("the audit-verify job notifies owners and admins when the chain is broken", async () => {
    const { owner, nikki } = await setup();
    expect((await runAuditVerifyJob()).ok).toBe(true);
    const { id } = await recordAudit(db, owner, { action: "test.verify", after: { amount: 100 } });
    const tamper = async (value: string) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`alter table audit_events disable trigger audit_events_no_update_delete`);
        await tx.execute(sql`update audit_events set after = ${value}::jsonb where id = ${id}`);
        await tx.execute(sql`alter table audit_events enable trigger audit_events_no_update_delete`);
      });
    await tamper('{"amount": 1}');
    try {
      const r = await runAuditVerifyJob();
      expect(r.ok).toBe(false);
      expect(r.breaks[0]).toMatchObject({ id, reason: "hash mismatch" });
      const ownerNotes = await listNotifications(db, owner);
      expect(ownerNotes.some((n) => n.n.kind === "audit_chain_break")).toBe(true);
      expect((await listNotifications(db, nikki)).some((n) => n.n.kind === "audit_chain_break")).toBe(false);
      expect(await markNotificationsRead(owner, "all")).toBeGreaterThan(0);
      expect(await countUnread(db, owner)).toBe(0);
    } finally {
      await tamper('{"amount": 100}');
    }
    expect((await runAuditVerifyJob()).ok).toBe(true);
  });
});
