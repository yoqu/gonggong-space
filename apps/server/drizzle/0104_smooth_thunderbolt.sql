CREATE TABLE "saved_messages" (
	"user_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"remind_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_messages_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "notify_level" text DEFAULT 'mentions' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_messages_due" ON "saved_messages" USING btree ("remind_at") WHERE "saved_messages"."done_at" is null and "saved_messages"."reminded_at" is null and "saved_messages"."remind_at" is not null;--> statement-breakpoint
UPDATE "group_members" gm SET "notify_level" = CASE WHEN gm."muted" THEN 'off' WHEN g."kind" = 'dm' THEN 'all' ELSE 'mentions' END FROM "groups" g WHERE g."id" = gm."group_id";
