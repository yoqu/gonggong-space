-- Usage analytics read prompt-cache tokens from runs.usage only; copy them from each run's last usage event.
UPDATE "runs" SET "usage" = "runs"."usage" || jsonb_build_object('cachedReadTokens', e.read)
FROM (
  SELECT DISTINCT ON ("run_id") "run_id", ("payload"->'breakdown'->'cache'->>'read')::bigint AS read
  FROM "run_events"
  WHERE "kind" = 'usage' AND "payload"->'breakdown'->'cache'->>'read' IS NOT NULL
  ORDER BY "run_id", "id" DESC
) e
WHERE "runs"."id" = e."run_id" AND "runs"."usage" IS NOT NULL AND "runs"."usage"->>'cachedReadTokens' IS NULL;
