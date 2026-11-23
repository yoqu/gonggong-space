CREATE TABLE "artifact_thread_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text NOT NULL,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reactions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artifact_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"anchor" jsonb NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"detail" text,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"sent_message_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "kind" text DEFAULT 'prototype' NOT NULL;--> statement-breakpoint
UPDATE "artifacts" SET "kind" = 'site' WHERE "site_dir" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "editor_version" text;--> statement-breakpoint
ALTER TABLE "artifact_thread_messages" ADD CONSTRAINT "artifact_thread_messages_thread_id_artifact_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."artifact_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_threads" ADD CONSTRAINT "artifact_threads_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_threads" ADD CONSTRAINT "artifact_threads_version_id_artifact_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_threads" ADD CONSTRAINT "artifact_threads_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_threads" ADD CONSTRAINT "artifact_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_thread_messages_thread" ON "artifact_thread_messages" USING btree ("thread_id","at");--> statement-breakpoint
CREATE INDEX "artifact_threads_artifact" ON "artifact_threads" USING btree ("artifact_id","version_id");--> statement-breakpoint
-- artifact_annotations stays one release for rollback; threads keep the annotation ids, the note is the first message.
INSERT INTO "artifact_threads" ("id", "artifact_id", "version_id", "anchor", "label", "detail", "location", "status", "resolved_by", "sent_message_id", "created_by", "created_at")
SELECT "id", "artifact_id", "version_id",
  jsonb_build_object('kind', 'prototype', 'file', "file", 'ggId', "gg_id", 'selector', "selector", 'rect', "rect", 'snippet', "snippet"),
  COALESCE(NULLIF("selector", ''), "file"),
  NULL,
  '{}'::jsonb,
  "status", NULL, "sent_message_id", "author_id", "created_at"
FROM "artifact_annotations";--> statement-breakpoint
INSERT INTO "artifact_thread_messages" ("thread_id", "author_kind", "author_id", "text", "at")
SELECT "id", 'user', "author_id", "note", "created_at" FROM "artifact_annotations";