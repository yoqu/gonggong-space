CREATE TABLE "installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"pin_version_id" uuid,
	"resolved_version_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installs_listing_id_scope_scope_id_unique" UNIQUE("listing_id","scope","scope_id")
);
--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "type" text DEFAULT 'plugin' NOT NULL;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "author_id" uuid;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "visibility" text;--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "status" text DEFAULT 'listed' NOT NULL;--> statement-breakpoint
ALTER TABLE "installs" ADD CONSTRAINT "installs_listing_id_plugins_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installs" ADD CONSTRAINT "installs_pin_version_id_plugin_versions_id_fk" FOREIGN KEY ("pin_version_id") REFERENCES "public"."plugin_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installs" ADD CONSTRAINT "installs_resolved_version_id_plugin_versions_id_fk" FOREIGN KEY ("resolved_version_id") REFERENCES "public"."plugin_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installs" ADD CONSTRAINT "installs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "installs_scope" ON "installs" USING btree ("scope","scope_id");--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "installs" ("listing_id", "scope", "scope_id", "resolved_version_id", "enabled", "updated_by", "updated_at")
  SELECT gp."plugin_id", 'group', gp."group_id", p."version_id", gp."enabled", gp."updated_by", gp."updated_at"
  FROM "group_plugins" gp JOIN "plugins" p ON p."id" = gp."plugin_id"
  WHERE p."version_id" IS NOT NULL;--> statement-breakpoint
DROP TABLE "group_plugins" CASCADE;
