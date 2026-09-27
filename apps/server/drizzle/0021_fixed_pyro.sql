CREATE TABLE "machine_repos" (
	"machine_id" uuid NOT NULL,
	"path" text NOT NULL,
	"repo_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_repos_machine_id_path_pk" PRIMARY KEY("machine_id","path")
);
--> statement-breakpoint
CREATE TABLE "repo_users" (
	"repo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_users_repo_id_user_id_pk" PRIMARY KEY("repo_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"last_branch" text,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repos_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "group_bots" ADD COLUMN "workspace_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "git_protocol" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "machine_repos" ADD CONSTRAINT "machine_repos_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_repos" ADD CONSTRAINT "machine_repos_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_users" ADD CONSTRAINT "repo_users_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_users" ADD CONSTRAINT "repo_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machine_repos_repo" ON "machine_repos" USING btree ("repo_id");