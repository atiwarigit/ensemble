CREATE TYPE "public"."lyric_contributor_role" AS ENUM('lyricist', 'co-writer', 'editor');--> statement-breakpoint
CREATE TYPE "public"."lyric_evidence_kind" AS ENUM('notebook_scan', 'voice_memo', 'doc', 'email');--> statement-breakpoint
CREATE TYPE "public"."lyric_origin" AS ENUM('human', 'human_edit_of_ai_suggestion', 'imported_original');--> statement-breakpoint
CREATE TYPE "public"."lyric_work_status" AS ENUM('draft', 'final', 'released');--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"external_ref" text,
	"notes" text,
	"logged_by" text NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lyric_contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"role" "lyric_contributor_role" NOT NULL,
	"share_bps" integer NOT NULL,
	"human" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lyric_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"version_id" uuid,
	"kind" "lyric_evidence_kind" NOT NULL,
	"file_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"description" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lyric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"body" text NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"parent_version_id" uuid,
	"origin" "lyric_origin" DEFAULT 'human' NOT NULL,
	"authored_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_written_at" date,
	"change_note" text
);
--> statement-breakpoint
CREATE TABLE "lyric_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "lyric_work_status" DEFAULT 'draft' NOT NULL,
	"primary_author_user_id" text,
	"isrc" text,
	"iswc" text,
	"finalized_at" timestamp with time zone,
	"finalized_by" text,
	"created_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_links" ADD CONSTRAINT "generation_links_work_id_lyric_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."lyric_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_links" ADD CONSTRAINT "generation_links_version_id_lyric_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."lyric_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_links" ADD CONSTRAINT "generation_links_logged_by_user_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_contributors" ADD CONSTRAINT "lyric_contributors_work_id_lyric_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."lyric_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_contributors" ADD CONSTRAINT "lyric_contributors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_evidence" ADD CONSTRAINT "lyric_evidence_work_id_lyric_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."lyric_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_evidence" ADD CONSTRAINT "lyric_evidence_version_id_lyric_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."lyric_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_evidence" ADD CONSTRAINT "lyric_evidence_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_evidence" ADD CONSTRAINT "lyric_evidence_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_versions" ADD CONSTRAINT "lyric_versions_work_id_lyric_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."lyric_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_versions" ADD CONSTRAINT "lyric_versions_parent_version_id_lyric_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."lyric_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_versions" ADD CONSTRAINT "lyric_versions_authored_by_user_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_works" ADD CONSTRAINT "lyric_works_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_works" ADD CONSTRAINT "lyric_works_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_works" ADD CONSTRAINT "lyric_works_primary_author_user_id_user_id_fk" FOREIGN KEY ("primary_author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_works" ADD CONSTRAINT "lyric_works_finalized_by_user_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyric_works" ADD CONSTRAINT "lyric_works_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_files_workspace_idx" ON "stored_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "generation_links_work_idx" ON "generation_links" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "lyric_contributors_work_idx" ON "lyric_contributors" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "lyric_evidence_work_idx" ON "lyric_evidence" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lyric_versions_work_no_idx" ON "lyric_versions" USING btree ("work_id","version_no");--> statement-breakpoint
CREATE INDEX "lyric_works_project_idx" ON "lyric_works" USING btree ("project_id");