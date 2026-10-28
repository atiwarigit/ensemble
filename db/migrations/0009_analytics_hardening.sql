CREATE TYPE "public"."alert_kind" AS ENUM('popularity_change', 'follower_milestone', 'streams_change', 's4a_stale');--> statement-breakpoint
CREATE TYPE "public"."s4a_metric" AS ENUM('streams', 'listeners', 'saves', 'playlist_adds', 'followers');--> statement-breakpoint
CREATE TYPE "public"."snapshot_entity" AS ENUM('artist', 'track');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'ok', 'partial', 'error', 'skipped');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"notification_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"alert_rule_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"data" jsonb,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "s4a_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"track_key" text DEFAULT '' NOT NULL,
	"track_name" text,
	"track_id" uuid,
	"metric" "s4a_metric" NOT NULL,
	"value" bigint NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spotify_artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"spotify_artist_id" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"linked_by" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	"unlinked_by" text
);
--> statement-breakpoint
CREATE TABLE "spotify_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_type" "snapshot_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"captured_on" date NOT NULL,
	"followers" bigint,
	"popularity" integer,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spotify_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"captured_on" date NOT NULL,
	"artists" integer DEFAULT 0 NOT NULL,
	"tracks" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"fields" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spotify_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"artist_link_id" uuid NOT NULL,
	"spotify_track_id" text NOT NULL,
	"name" text NOT NULL,
	"isrc" text,
	"album_name" text,
	"album_type" text,
	"release_date" text,
	"duration_ms" integer,
	"first_seen_on" date NOT NULL,
	"last_seen_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "s4a_config" jsonb;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s4a_metrics" ADD CONSTRAINT "s4a_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s4a_metrics" ADD CONSTRAINT "s4a_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s4a_metrics" ADD CONSTRAINT "s4a_metrics_track_id_spotify_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."spotify_tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "s4a_metrics" ADD CONSTRAINT "s4a_metrics_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_artists" ADD CONSTRAINT "spotify_artists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_artists" ADD CONSTRAINT "spotify_artists_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_artists" ADD CONSTRAINT "spotify_artists_linked_by_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_artists" ADD CONSTRAINT "spotify_artists_unlinked_by_user_id_fk" FOREIGN KEY ("unlinked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_snapshots" ADD CONSTRAINT "spotify_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_snapshots" ADD CONSTRAINT "spotify_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_tracks" ADD CONSTRAINT "spotify_tracks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_tracks" ADD CONSTRAINT "spotify_tracks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_tracks" ADD CONSTRAINT "spotify_tracks_artist_link_id_spotify_artists_id_fk" FOREIGN KEY ("artist_link_id") REFERENCES "public"."spotify_artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_kind_uq" ON "alert_rules" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_project_idx" ON "notifications" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "s4a_metrics_point_uq" ON "s4a_metrics" USING btree ("project_id","date","track_key","metric") WHERE "s4a_metrics"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "s4a_metrics_batch_idx" ON "s4a_metrics" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spotify_artists_active_uq" ON "spotify_artists" USING btree ("project_id","spotify_artist_id") WHERE "spotify_artists"."unlinked_at" is null;--> statement-breakpoint
CREATE INDEX "spotify_artists_workspace_idx" ON "spotify_artists" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spotify_snapshots_day_uq" ON "spotify_snapshots" USING btree ("entity_type","entity_id","captured_on");--> statement-breakpoint
CREATE INDEX "spotify_snapshots_project_idx" ON "spotify_snapshots" USING btree ("project_id","captured_on");--> statement-breakpoint
CREATE INDEX "spotify_sync_runs_started_idx" ON "spotify_sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spotify_tracks_uq" ON "spotify_tracks" USING btree ("artist_link_id","spotify_track_id");--> statement-breakpoint
CREATE INDEX "spotify_tracks_project_idx" ON "spotify_tracks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "spotify_tracks_isrc_idx" ON "spotify_tracks" USING btree ("isrc");