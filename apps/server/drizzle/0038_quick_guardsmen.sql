CREATE TABLE "sync_changes" (
	"group_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"path" text NOT NULL,
	"hash" text,
	"exec" boolean NOT NULL,
	CONSTRAINT "sync_changes_group_id_version_path_pk" PRIMARY KEY("group_id","version","path")
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"submit_id" uuid NOT NULL,
	"base_version" integer NOT NULL,
	"head_version" integer NOT NULL,
	"changes" jsonb NOT NULL,
	"conflicts" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_conflicts_submit_id_unique" UNIQUE("submit_id")
);
--> statement-breakpoint
CREATE TABLE "sync_head" (
	"group_id" uuid NOT NULL,
	"path" text NOT NULL,
	"hash" text NOT NULL,
	"exec" boolean NOT NULL,
	CONSTRAINT "sync_head_group_id_path_pk" PRIMARY KEY("group_id","path")
);
--> statement-breakpoint
CREATE TABLE "sync_replicas" (
	"group_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"version" integer,
	"root_hash" text,
	"issue" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"last_conflict" jsonb,
	"synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_replicas_group_id_bot_id_pk" PRIMARY KEY("group_id","bot_id")
);
--> statement-breakpoint
CREATE TABLE "sync_versions" (
	"group_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"submit_id" uuid,
	"author_kind" text NOT NULL,
	"author_id" uuid NOT NULL,
	"run_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"files" integer NOT NULL,
	"root_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_versions_group_id_version_pk" PRIMARY KEY("group_id","version"),
	CONSTRAINT "sync_versions_submit_id_unique" UNIQUE("submit_id")
);
--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_head" ADD CONSTRAINT "sync_head_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_replicas" ADD CONSTRAINT "sync_replicas_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_replicas" ADD CONSTRAINT "sync_replicas_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_versions" ADD CONSTRAINT "sync_versions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_conflicts_group" ON "sync_conflicts" USING btree ("group_id","resolved_at");