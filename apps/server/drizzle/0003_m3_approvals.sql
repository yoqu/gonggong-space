CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"title" text NOT NULL,
	"tool_kind" text NOT NULL,
	"detail" text NOT NULL,
	"options" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "interrupt" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "stopped_by" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "patch" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_run" ON "approvals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "approvals_pending" ON "approvals" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_stopped_by_users_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;