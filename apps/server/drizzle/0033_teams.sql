CREATE TABLE "team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP CONSTRAINT "mcp_servers_name_unique";--> statement-breakpoint
ALTER TABLE "repos" DROP CONSTRAINT "repos_key_unique";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "scope" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "team_id" uuid;--> statement-breakpoint
-- Existing data moves into one default team (plan D18): every account joins, the earliest sysadmin owns it.
DO $$
DECLARE
  team uuid;
  owner uuid;
BEGIN
  SELECT id INTO owner FROM users ORDER BY disabled_at IS NOT NULL, role <> 'sysadmin', created_at, id LIMIT 1;
  IF owner IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO teams (name, created_by) VALUES ('默认团队', owner) RETURNING id INTO team;
  INSERT INTO team_members (team_id, user_id, role, joined_at)
    SELECT team, id, CASE WHEN id = owner THEN 'owner' ELSE 'member' END, created_at FROM users;
  UPDATE groups SET team_id = team;
  UPDATE bots SET team_id = team;
  UPDATE repos SET team_id = team;
  UPDATE notifications SET team_id = team;
  UPDATE audit_logs SET team_id = team WHERE group_id IN (SELECT id FROM groups);
END $$;
--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_user" ON "team_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "bots" ADD CONSTRAINT "bots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_scope_team_id_group_id_name_unique" UNIQUE NULLS NOT DISTINCT("scope","team_id","group_id","name");--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_team_id_key_unique" UNIQUE("team_id","key");