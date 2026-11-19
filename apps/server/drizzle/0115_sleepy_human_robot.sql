CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_by_bot_id" uuid,
	"created_by_run_id" uuid,
	"name" text NOT NULL,
	"token_hash" text,
	"bot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_template" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_called_at" timestamp with time zone,
	"last_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_bot_id_bots_id_fk" FOREIGN KEY ("created_by_bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhooks_group" ON "webhooks" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhooks_token_hash" ON "webhooks" USING btree ("token_hash") WHERE "webhooks"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "messages_webhook_dedupe" ON "messages" USING btree (("meta"->>'webhookOf'),("meta"->>'webhookDedupe'),"created_at") WHERE ("messages"."meta"->>'webhookDedupe') is not null;