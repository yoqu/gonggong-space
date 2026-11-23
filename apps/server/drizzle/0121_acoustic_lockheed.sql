CREATE TABLE "connector_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"account" text,
	"detail" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_states_user_id_team_id_name_unique" UNIQUE("user_id","team_id","name")
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "connectors_off" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_states" ADD CONSTRAINT "connector_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_states" ADD CONSTRAINT "connector_states_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;