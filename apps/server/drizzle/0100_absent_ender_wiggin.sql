CREATE TABLE "sidebar_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "sidebar_sections" ADD CONSTRAINT "sidebar_sections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_sections" ADD CONSTRAINT "sidebar_sections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sidebar_sections_user" ON "sidebar_sections" USING btree ("user_id","team_id");--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_section_id_sidebar_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sidebar_sections"("id") ON DELETE set null ON UPDATE no action;