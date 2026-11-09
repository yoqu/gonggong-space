ALTER TABLE "bots" ALTER COLUMN "ai_review" SET DEFAULT true;--> statement-breakpoint
UPDATE "bots" SET "always_allow" = (SELECT COALESCE(jsonb_agg(DISTINCT r), '[]'::jsonb) FROM jsonb_array_elements("always_allow" || "allowlist") AS r) WHERE "approval" = 'allowlist';--> statement-breakpoint
UPDATE "bots" SET "ai_review" = true WHERE "approval" = 'all';--> statement-breakpoint
UPDATE "bots" SET "approval" = 'ask', "allowlist" = '[]'::jsonb;
