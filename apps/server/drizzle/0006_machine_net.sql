ALTER TABLE "machines" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "bandwidth_mbps" double precision;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "net_measured_at" timestamp with time zone;