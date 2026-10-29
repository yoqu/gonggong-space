ALTER TABLE "artifacts" ADD COLUMN "favorites" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "checkout_bot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;