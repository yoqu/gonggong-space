ALTER TABLE "sidebar_sections" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "team_sections" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "sidebar_sections" ADD CONSTRAINT "sidebar_sections_parent_id_sidebar_sections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."sidebar_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_sections" ADD CONSTRAINT "team_sections_parent_id_team_sections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."team_sections"("id") ON DELETE cascade ON UPDATE no action;