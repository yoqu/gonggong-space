CREATE TABLE "link_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"machine" jsonb NOT NULL,
	"create_bot_agent" text,
	"hint_user_id" uuid,
	"ip" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "link_requests" ADD CONSTRAINT "link_requests_hint_user_id_users_id_fk" FOREIGN KEY ("hint_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_requests" ADD CONSTRAINT "link_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_requests_hint_idx" ON "link_requests" USING btree ("hint_user_id","status");