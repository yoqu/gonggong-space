CREATE TABLE "plugin_trusts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"plugin_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "plugin_trusts_machine_id_version_id_unique" UNIQUE("machine_id","version_id")
);
--> statement-breakpoint
ALTER TABLE "plugin_trusts" ADD CONSTRAINT "plugin_trusts_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_trusts" ADD CONSTRAINT "plugin_trusts_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_trusts" ADD CONSTRAINT "plugin_trusts_version_id_plugin_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."plugin_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_trusts" ADD CONSTRAINT "plugin_trusts_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;