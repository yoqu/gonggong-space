ALTER TABLE "runs" ADD COLUMN "finalizing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "appends_applied" integer DEFAULT 0 NOT NULL;