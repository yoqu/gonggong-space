ALTER TABLE "approvals" ADD COLUMN "review" jsonb;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "ai_review" boolean DEFAULT false NOT NULL;