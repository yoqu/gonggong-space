ALTER TABLE "bots" ADD COLUMN "approval" text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL;