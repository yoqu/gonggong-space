ALTER TABLE "group_repos" ADD COLUMN "is_primary" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Only one repo per group was allowed so far; should a group still have more, its oldest stays the main one.
UPDATE "group_repos" g SET "is_primary" = false WHERE EXISTS (SELECT 1 FROM "group_repos" o WHERE o."group_id" = g."group_id" AND (o."created_at", o."id") < (g."created_at", g."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "group_repos_primary" ON "group_repos" USING btree ("group_id") WHERE "group_repos"."is_primary";