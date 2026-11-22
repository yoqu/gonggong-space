ALTER TABLE "bots" ADD COLUMN "access" jsonb DEFAULT '{"trusted":"ask","others":"auto"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "audience" text;--> statement-breakpoint
-- Existing bots keep running everyone at the owner's level (who may trigger is still trigger_scope).
UPDATE "bots" SET "access" = jsonb_build_object('trusted', l.level, 'others', l.level)
FROM (SELECT "id", CASE "tier" WHEN 'workspace' THEN CASE WHEN "ai_review" THEN 'auto' ELSE 'ask' END ELSE "tier" END AS level FROM "bots") l
WHERE l."id" = "bots"."id";
