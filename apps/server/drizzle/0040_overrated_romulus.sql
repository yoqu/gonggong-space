ALTER TABLE "groups" ADD COLUMN "sync_switch" jsonb;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "sync_archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_replicas" ADD COLUMN "joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_replicas" ADD COLUMN "pending" text;