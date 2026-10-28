CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."approval_required_role" AS ENUM('lead', 'owner');--> statement-breakpoint
CREATE TYPE "public"."rights_package_kind" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"action_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_by_actor" text DEFAULT 'user' NOT NULL,
	"reason" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"required_role" "approval_required_role" NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rights_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"kind" "rights_package_kind" NOT NULL,
	"file_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"zip_sha256" char(64) NOT NULL,
	"pdf_sha256" char(64) NOT NULL,
	"manifest_sha256" char(64) NOT NULL,
	"sha256sums" text NOT NULL,
	"chain_head_id" bigint,
	"chain_head_hash" char(64),
	"approval_request_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_packages" ADD CONSTRAINT "rights_packages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_packages" ADD CONSTRAINT "rights_packages_work_id_lyric_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."lyric_works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_packages" ADD CONSTRAINT "rights_packages_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_packages" ADD CONSTRAINT "rights_packages_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_packages" ADD CONSTRAINT "rights_packages_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_workspace_status_idx" ON "approval_requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "approval_requests_entity_idx" ON "approval_requests" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_one_pending_idx" ON "approval_requests" USING btree ("action_type","entity_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "rights_packages_work_idx" ON "rights_packages" USING btree ("work_id","created_at");