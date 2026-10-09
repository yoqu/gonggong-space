ALTER TABLE "approvals" ADD COLUMN "remember" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "always_allow" jsonb DEFAULT '[]'::jsonb NOT NULL;