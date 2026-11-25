ALTER TABLE "group_members" ADD COLUMN "section_moved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "default_section" text;