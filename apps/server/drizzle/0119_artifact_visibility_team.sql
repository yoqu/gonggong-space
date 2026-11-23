-- Retire cross-team `all` visibility: downgrade existing works and their message cards to `team`.
UPDATE "artifacts" SET "visibility" = 'team' WHERE "visibility" = 'all';--> statement-breakpoint
UPDATE "messages"
SET "meta" = jsonb_set("meta", '{card,visibility}', '"team"', false)
WHERE "meta"->'card'->>'visibility' = 'all';
