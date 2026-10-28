import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { importBatches } from "./expenses";
import { projects, workspaces } from "./tenancy";

/** A Spotify artist linked to a project. Linking and unlinking go through approvals. */
export const spotifyArtists = pgTable(
  "spotify_artists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    spotifyArtistId: text("spotify_artist_id").notNull(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    linkedBy: text("linked_by").references(() => user.id),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    unlinkedAt: timestamp("unlinked_at", { withTimezone: true }),
    unlinkedBy: text("unlinked_by").references(() => user.id),
  },
  (t) => [
    uniqueIndex("spotify_artists_active_uq").on(t.projectId, t.spotifyArtistId).where(sql`${t.unlinkedAt} is null`),
    index("spotify_artists_workspace_idx").on(t.workspaceId),
  ],
);

/** Tracks found in a linked artist's albums and singles. Refreshed by the daily snapshot. */
export const spotifyTracks = pgTable(
  "spotify_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    artistLinkId: uuid("artist_link_id")
      .notNull()
      .references(() => spotifyArtists.id),
    spotifyTrackId: text("spotify_track_id").notNull(),
    name: text("name").notNull(),
    isrc: text("isrc"),
    albumName: text("album_name"),
    albumType: text("album_type"),
    /** Spotify's release date, which may be just a year or a year-month. */
    releaseDate: text("release_date"),
    durationMs: integer("duration_ms"),
    firstSeenOn: date("first_seen_on").notNull(),
    lastSeenOn: date("last_seen_on").notNull(),
  },
  (t) => [
    uniqueIndex("spotify_tracks_uq").on(t.artistLinkId, t.spotifyTrackId),
    index("spotify_tracks_project_idx").on(t.projectId),
    index("spotify_tracks_isrc_idx").on(t.isrc),
  ],
);

export const snapshotEntity = pgEnum("snapshot_entity", ["artist", "track"]);

/**
 * One row per entity per UTC day. `followers` and `popularity` are null when Spotify doesn't return
 * them, which is the case for Development Mode apps since February 2026.
 */
export const spotifySnapshots = pgTable(
  "spotify_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    entityType: snapshotEntity("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    capturedOn: date("captured_on").notNull(),
    followers: bigint("followers", { mode: "number" }),
    popularity: integer("popularity"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("spotify_snapshots_day_uq").on(t.entityType, t.entityId, t.capturedOn),
    index("spotify_snapshots_project_idx").on(t.projectId, t.capturedOn),
  ],
);

export const syncStatus = pgEnum("sync_status", ["running", "ok", "partial", "error", "skipped"]);

export const spotifySyncRuns = pgTable(
  "spotify_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: text("trigger").notNull(),
    status: syncStatus("status").notNull().default("running"),
    capturedOn: date("captured_on").notNull(),
    artists: integer("artists").notNull().default(0),
    tracks: integer("tracks").notNull().default(0),
    requests: integer("requests").notNull().default(0),
    retries: integer("retries").notNull().default(0),
    /** Which optional fields Spotify returned, e.g. { followers: false, popularity: false }. */
    fields: jsonb("fields").$type<{ followers: boolean; popularity: boolean }>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("spotify_sync_runs_started_idx").on(t.startedAt)],
);

export const s4aMetric = pgEnum("s4a_metric", ["streams", "listeners", "saves", "playlist_adds", "followers"]);

/** Daily numbers from Spotify for Artists CSV exports. `trackKey` is '' for artist-level rows. */
export const s4aMetrics = pgTable(
  "s4a_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    date: date("date").notNull(),
    trackKey: text("track_key").notNull().default(""),
    trackName: text("track_name"),
    trackId: uuid("track_id").references(() => spotifyTracks.id),
    metric: s4aMetric("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    importBatchId: uuid("import_batch_id")
      .notNull()
      .references(() => importBatches.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("s4a_metrics_point_uq")
      .on(t.projectId, t.date, t.trackKey, t.metric)
      .where(sql`${t.archivedAt} is null`),
    index("s4a_metrics_batch_idx").on(t.importBatchId),
  ],
);

export const alertKind = pgEnum("alert_kind", ["popularity_change", "follower_milestone", "streams_change", "s4a_stale"]);

export type AlertParams = {
  /** popularity_change: points; streams_change: percent. */
  threshold?: number;
  /** Comparison window in days. */
  days?: number;
  /** follower_milestone: fire when followers cross a multiple of this. */
  step?: number;
};

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: alertKind("kind").notNull(),
    params: jsonb("params").$type<AlertParams>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("alert_rules_kind_uq").on(t.projectId, t.kind)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id),
    alertRuleId: uuid("alert_rule_id").references(() => alertRules.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    data: jsonb("data"),
    /** Stops the same alert firing twice for the same situation. */
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.workspaceId, t.dedupeKey),
    index("notifications_project_idx").on(t.projectId, t.createdAt),
  ],
);

export const notificationReads = pgTable(
  "notification_reads",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);

/** Fixed-window counters for rate limiting (auth and chat). Old windows are pruned by the retention job. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** Results of scheduled jobs (audit-chain check, retention, Spotify), shown on the System page. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    ok: boolean("ok").notNull(),
    detail: jsonb("detail"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("job_runs_job_idx").on(t.job, t.startedAt)],
);
