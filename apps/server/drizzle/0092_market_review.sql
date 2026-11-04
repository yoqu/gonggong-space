ALTER TABLE "plugin_versions" ADD COLUMN "review_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_versions" ADD COLUMN "reviewer_id" uuid;--> statement-breakpoint
ALTER TABLE "plugin_versions" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "plugin_versions" ADD COLUMN "changelog" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "listed_version_id" uuid;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "gh_source" jsonb;--> statement-breakpoint
ALTER TABLE "plugin_versions" ADD CONSTRAINT "plugin_versions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "plugins" SET "listed_version_id" = "version_id";