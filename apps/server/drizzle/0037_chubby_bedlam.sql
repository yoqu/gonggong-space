CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by_bot_id" uuid,
	"created_by_run_id" uuid,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"cron" text,
	"run_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"bot_ids" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"paused_reason" jsonb,
	"next_run_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"last_run_id" uuid,
	"last_bot_id" uuid,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_bot_id_bots_id_fk" FOREIGN KEY ("created_by_bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedules_due" ON "schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "schedules_group" ON "schedules" USING btree ("group_id");