import { z } from 'zod'
import { KNOWLEDGE_BODY_MAX, KNOWLEDGE_TAGS_MAX, KNOWLEDGE_TITLE_MAX } from './web.js'

// ── Group knowledge base tools (agent-facing, not translated) ───────────────
const kbId = z.string().describe('Entry id (from kb_list / kb_search)')
const kbTitle = z.string().trim().min(1).max(KNOWLEDGE_TITLE_MAX).describe('Title that says what it is about')
const kbBody = z
  .string()
  .max(KNOWLEDGE_BODY_MAX)
  .describe('Markdown body: the facts, not the chat that led to them')
const kbTags = z
  .array(z.string().trim().min(1).max(30))
  .max(KNOWLEDGE_TAGS_MAX)
  .describe('Tags, e.g. 约定, 环境, 部署; the full list when changing')
export const KbListArgs = z.object({ tag: z.string().describe('Only entries with this tag').optional() })
export const KbGetArgs = z.object({ id: kbId })
export const KbSearchArgs = z.object({
  query: z.string().min(1).max(200).describe('Keyword matched against title, body and tags'),
  limit: z.number().int().min(1).max(50).describe('Default 10').optional(),
})
export const KbCreateArgs = z.object({ title: kbTitle, body: kbBody, tags: kbTags.optional() })
export const KbUpdateArgs = z.object({
  id: kbId,
  base_version: z
    .number()
    .int()
    .min(1)
    .describe('Version you read (from kb_get); fails if the entry changed since'),
  title: kbTitle.optional(),
  body: kbBody.describe('Full new body (replaces it)').optional(),
  tags: kbTags.optional(),
})
export const KbDeleteArgs = z.object({ id: kbId })
