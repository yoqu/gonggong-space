CREATE TABLE "artifact_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"file" text NOT NULL,
	"gg_id" text,
	"selector" text NOT NULL,
	"rect" jsonb NOT NULL,
	"snippet" text NOT NULL,
	"note" text NOT NULL,
	"author_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"sent_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"parent_version_id" uuid,
	"source" text NOT NULL,
	"run_id" uuid,
	"user_id" uuid,
	"submit_key" text,
	"files" jsonb NOT NULL,
	"digest" text NOT NULL,
	"thumbnail_hash" text,
	"stale" boolean DEFAULT false NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_versions_artifact_id_n_unique" UNIQUE("artifact_id","n"),
	CONSTRAINT "artifact_versions_artifact_id_submit_key_unique" UNIQUE("artifact_id","submit_key")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"plugin_id" uuid,
	"plugin_version_id" uuid,
	"design_system_id" text,
	"title" text NOT NULL,
	"dir" text NOT NULL,
	"bot_id" uuid,
	"head_version_id" uuid,
	"created_by" uuid,
	"message_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_group_id_dir_unique" UNIQUE("group_id","dir")
);
--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "artifact_version_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact_annotations" ADD CONSTRAINT "artifact_annotations_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_annotations" ADD CONSTRAINT "artifact_annotations_version_id_artifact_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_annotations" ADD CONSTRAINT "artifact_annotations_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_plugin_version_id_plugin_versions_id_fk" FOREIGN KEY ("plugin_version_id") REFERENCES "public"."plugin_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_annotations_artifact" ON "artifact_annotations" USING btree ("artifact_id","version_id");--> statement-breakpoint
CREATE INDEX "artifacts_bot" ON "artifacts" USING btree ("bot_id");--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "previews_artifact" ON "previews" USING btree ("artifact_id") WHERE "previews"."artifact_id" is not null;