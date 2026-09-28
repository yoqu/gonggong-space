CREATE TABLE "git_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"login" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_accounts_user_id_base_url_login_unique" UNIQUE("user_id","base_url","login")
);
--> statement-breakpoint
ALTER TABLE "git_accounts" ADD CONSTRAINT "git_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;