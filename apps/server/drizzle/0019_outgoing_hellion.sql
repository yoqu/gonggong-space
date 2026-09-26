UPDATE "groups" g SET "notice_id" = n."id" FROM "group_notices" n WHERE n."group_id" = g."id" AND n."removed_at" IS NULL AND g."notice" <> '';--> statement-breakpoint
ALTER TABLE "group_members" DROP COLUMN "notice_hidden_at";--> statement-breakpoint
ALTER TABLE "groups" DROP COLUMN "notice_at";