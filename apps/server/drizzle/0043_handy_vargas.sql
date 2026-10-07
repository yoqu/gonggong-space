CREATE INDEX "group_members_user" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_run" ON "messages" USING btree ("run_id") WHERE "messages"."run_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_client_id" ON "messages" USING btree ("group_id","author_user_id",("meta"->>'clientId')) WHERE ("messages"."meta"->>'clientId') is not null;--> statement-breakpoint
CREATE INDEX "notifications_unresolved" ON "notifications" USING btree ("type") WHERE "notifications"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "runs_trigger" ON "runs" USING btree ("trigger_message_id");--> statement-breakpoint
CREATE INDEX "runs_started" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "runs_waiting" ON "runs" USING btree ("created_at") WHERE "runs"."status" = 'offline_wait';--> statement-breakpoint
CREATE INDEX "runs_finalizing" ON "runs" USING btree ("bot_id") WHERE "runs"."finalizing";--> statement-breakpoint
CREATE INDEX "runs_unpurged_ended" ON "runs" USING btree ("ended_at") WHERE "runs"."purged_at" is null;