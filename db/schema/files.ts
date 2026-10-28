import { customType, index, integer, pgTable, text, timestamp, uuid, char } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspaces } from "./tenancy";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Uploaded file bodies (lyric evidence, rights packages). Kept in Postgres so the app runs with no
 * object store; swap for Vercel Blob by replacing lib/services/files.ts.
 */
export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    data: bytea("data").notNull(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stored_files_workspace_idx").on(t.workspaceId)],
);
