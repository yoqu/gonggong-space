ALTER TABLE "group_members" ADD COLUMN "hidden_notice_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "notice_id" uuid;