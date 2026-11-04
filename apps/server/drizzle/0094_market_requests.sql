CREATE TABLE "install_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"pin_version_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requester_id" uuid NOT NULL,
	"decided_by" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "plugins" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "install_requests" ADD CONSTRAINT "install_requests_listing_id_plugins_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_requests" ADD CONSTRAINT "install_requests_pin_version_id_plugin_versions_id_fk" FOREIGN KEY ("pin_version_id") REFERENCES "public"."plugin_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_requests" ADD CONSTRAINT "install_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_requests" ADD CONSTRAINT "install_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "install_requests_pending" ON "install_requests" USING btree ("listing_id","scope","scope_id") WHERE "install_requests"."status" = 'pending';