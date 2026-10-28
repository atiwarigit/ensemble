import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { storedFiles } from "./files";
import { projects, workspaces } from "./tenancy";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};

export const lyricWorkStatus = pgEnum("lyric_work_status", ["draft", "final", "released"]);
export const lyricOrigin = pgEnum("lyric_origin", ["human", "human_edit_of_ai_suggestion", "imported_original"]);
export const contributorRole = pgEnum("lyric_contributor_role", ["lyricist", "co-writer", "editor"]);
export const evidenceKind = pgEnum("lyric_evidence_kind", ["notebook_scan", "voice_memo", "doc", "email"]);

export type LyricWorkStatus = (typeof lyricWorkStatus.enumValues)[number];
export type LyricOrigin = (typeof lyricOrigin.enumValues)[number];
export type ContributorRole = (typeof contributorRole.enumValues)[number];
export type EvidenceKind = (typeof evidenceKind.enumValues)[number];

export const lyricWorks = pgTable(
  "lyric_works",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    status: lyricWorkStatus("status").notNull().default("draft"),
    primaryAuthorUserId: text("primary_author_user_id").references(() => user.id),
    isrc: text("isrc"),
    iswc: text("iswc"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: text("finalized_by").references(() => user.id),
    createdBy: text("created_by").references(() => user.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("lyric_works_project_idx").on(t.projectId)],
);

/** Immutable: a trigger rejects UPDATE/DELETE and sets recorded_at and content_sha256 itself. */
export const lyricVersions = pgTable(
  "lyric_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => lyricWorks.id),
    versionNo: integer("version_no").notNull(),
    body: text("body").notNull(),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    parentVersionId: uuid("parent_version_id").references((): AnyPgColumn => lyricVersions.id),
    origin: lyricOrigin("origin").notNull().default("human"),
    authoredBy: text("authored_by")
      .notNull()
      .references(() => user.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    /** The author's own statement of when an older text was written. Never treated as proof. */
    claimedWrittenAt: date("claimed_written_at", { mode: "string" }),
    changeNote: text("change_note"),
  },
  (t) => [uniqueIndex("lyric_versions_work_no_idx").on(t.workId, t.versionNo)],
);

export const lyricContributors = pgTable(
  "lyric_contributors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => lyricWorks.id),
    name: text("name").notNull(),
    userId: text("user_id").references(() => user.id),
    role: contributorRole("role").notNull(),
    /** Basis points: 10000 = 100%. A work's shares always sum to 10000. */
    shareBps: integer("share_bps").notNull(),
    human: boolean("human").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lyric_contributors_work_idx").on(t.workId)],
);

export const lyricEvidence = pgTable(
  "lyric_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => lyricWorks.id),
    versionId: uuid("version_id").references(() => lyricVersions.id),
    kind: evidenceKind("kind").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    description: text("description"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lyric_evidence_work_idx").on(t.workId)],
);

/** Generations made outside Ensemble (e.g. in Suno). Each must point at a recorded lyric version. */
export const generationLinks = pgTable(
  "generation_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => lyricWorks.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => lyricVersions.id),
    tool: text("tool").notNull(),
    externalRef: text("external_ref"),
    notes: text("notes"),
    loggedBy: text("logged_by")
      .notNull()
      .references(() => user.id),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("generation_links_work_idx").on(t.workId)],
);
