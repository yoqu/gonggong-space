-- Approvals and questions settled before resolved_at existed.
UPDATE "notifications" n SET "resolved_at" = now(), "read_at" = coalesce(n."read_at", now())
WHERE n."resolved_at" IS NULL AND n."type" = 'approval'
  AND EXISTS (SELECT 1 FROM "approvals" a WHERE a."id"::text = n."payload"->>'approvalId' AND a."status" <> 'pending');
--> statement-breakpoint
UPDATE "notifications" n SET "resolved_at" = now(), "read_at" = coalesce(n."read_at", now())
WHERE n."resolved_at" IS NULL AND n."type" = 'question'
  AND EXISTS (SELECT 1 FROM "question_sets" q WHERE q."id"::text = n."payload"->>'questionSetId' AND q."status" <> 'pending');
