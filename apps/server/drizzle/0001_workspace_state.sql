ALTER TABLE "group_bots" ADD COLUMN "workspace_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_bots" ADD COLUMN "workspace_path" text;--> statement-breakpoint
ALTER TABLE "group_bots" ADD COLUMN "workspace_error" text;