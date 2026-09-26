CREATE TABLE "group_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "notice_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_notices" ADD CONSTRAINT "group_notices_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_notices" ADD CONSTRAINT "group_notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "groups" SET "notice_at" = now() WHERE "notice" <> '';--> statement-breakpoint
INSERT INTO "group_notices" ("group_id", "body", "created_by", "created_at") SELECT "id", "notice", "created_by", "notice_at" FROM "groups" WHERE "notice" <> '';
