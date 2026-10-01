CREATE TABLE "feishu_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"team_id" uuid,
	"bot_id" uuid,
	"app_id" text NOT NULL,
	"app_secret" text NOT NULL,
	"status" text DEFAULT 'connecting' NOT NULL,
	"error" text,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feishu_apps_bot_id_unique" UNIQUE("bot_id"),
	CONSTRAINT "feishu_apps_app_id_unique" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE "feishu_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"bound_by" uuid NOT NULL,
	"unbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feishu_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"union_id" text NOT NULL,
	"feishu_user_id" text,
	"open_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"avatar" text,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feishu_identities_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "feishu_identities_union_id_unique" UNIQUE("union_id")
);
--> statement-breakpoint
CREATE TABLE "feishu_message_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feishu_message_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"app_id" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"message_id" uuid,
	"run_id" uuid,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feishu_message_links_feishu_message_id_unique" UNIQUE("feishu_message_id")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feishu_apps" ADD CONSTRAINT "feishu_apps_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feishu_apps" ADD CONSTRAINT "feishu_apps_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feishu_apps" ADD CONSTRAINT "feishu_apps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feishu_chats" ADD CONSTRAINT "feishu_chats_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feishu_chats" ADD CONSTRAINT "feishu_chats_bound_by_users_id_fk" FOREIGN KEY ("bound_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feishu_identities" ADD CONSTRAINT "feishu_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feishu_message_links" ADD CONSTRAINT "feishu_message_links_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feishu_message_links" ADD CONSTRAINT "feishu_message_links_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_apps_one_main" ON "feishu_apps" USING btree ("kind") WHERE "feishu_apps"."kind" = 'main';--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_chats_group" ON "feishu_chats" USING btree ("group_id") WHERE "feishu_chats"."unbound_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_chats_chat" ON "feishu_chats" USING btree ("chat_id") WHERE "feishu_chats"."unbound_at" is null;--> statement-breakpoint
CREATE INDEX "feishu_links_message" ON "feishu_message_links" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "feishu_links_run" ON "feishu_message_links" USING btree ("run_id");