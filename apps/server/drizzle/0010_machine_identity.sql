ALTER TABLE "machines" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "hardware_id" text;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "system" jsonb;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "bound_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_hardware_id_unique" UNIQUE("hardware_id");--> statement-breakpoint
UPDATE "machines" SET "bound_at" = "created_at";