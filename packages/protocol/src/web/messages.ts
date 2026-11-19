import { z } from 'zod'
import { ArtifactContext, MessageCanvas } from '../artifacts.js'
import { Attachment, MAX_ATTACHMENTS, RunConfigPick } from '../common.js'
import { FeishuIssueEvent } from '../feishu-errors.js'
import { HtmlRenderRef } from '../html-render.js'
import { I18nText } from '../i18n.js'
import { MessageCard } from '../plugins.js'
import { SecretCard } from '../secrets.js'
import { ActionAnswer } from '../ui-blocks.js'
import { GroupDto } from './groups.js'
import { RunDto } from './runs.js'

// ── Timeline ────────────────────────────────────────────────────────────────
/** Fixed set of emoji reactions, in display order. */
export const REACTION_EMOJIS = ['👍', '✅', '👀', '🎉', '❤️', '😂'] as const
export const ReactionEmoji = z.enum(REACTION_EMOJIS)
export type ReactionEmoji = z.infer<typeof ReactionEmoji>
/** One emoji's aggregate on a message, from the viewer's perspective; `users`: reactors, oldest first. */
export const ReactionDto = z.object({
  emoji: ReactionEmoji,
  count: z.number().int().positive(),
  mine: z.boolean(),
  users: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type ReactionDto = z.infer<typeof ReactionDto>
/** PUT | DELETE /api/messages/:id/reactions/:emoji — the message's reactions after the change. */
export const ReactionsDto = z.object({
  groupId: z.string(),
  messageId: z.string(),
  reactions: z.array(ReactionDto),
})
export type ReactionsDto = z.infer<typeof ReactionsDto>

/** A 填写密钥 card: `userId` (the run's originator) fills `keys` of MCP server `name`. */
export const McpSecretCard = z.object({
  id: z.string(),
  name: z.string(),
  keys: z.array(z.string()),
  userId: z.string(),
  filled: z.boolean(),
})
export type McpSecretCard = z.infer<typeof McpSecretCard>
/** 消息置顶: any member pins or unpins; at most this many per group; a recalled message is unpinned. */
export const MAX_PINS = 5
export const PinnedMessageDto = z.object({
  messageId: z.string(),
  seq: z.number().int(),
  authorName: z.string(),
  /** The message text, cut to a line for the banner ('' when it carries only attachments). */
  text: z.string(),
  attachments: z.number().int(),
  /** Set when the pinned message is a thread reply: its thread opens to locate it. */
  threadRootId: z.string().optional(),
  pinnedBy: z.object({ id: z.string(), name: z.string() }),
  pinnedAt: z.string(),
})
export type PinnedMessageDto = z.infer<typeof PinnedMessageDto>
/** GET /api/groups/:id/pins (newest pin first); POST …/pins {messageId}; DELETE …/pins/:messageId. */
export const GroupPinsDto = z.object({ pins: z.array(PinnedMessageDto) })
export type GroupPinsDto = z.infer<typeof GroupPinsDto>
export const PinMessageReq = z.object({ messageId: z.string().uuid() })

/** A stage of a progress card. */
export const ProgressStageStatus = z.enum(['pending', 'running', 'done', 'failed', 'skipped'])
export type ProgressStageStatus = z.infer<typeof ProgressStageStatus>
export const ProgressStage = z.object({ name: z.string().min(1).max(40), status: ProgressStageStatus })
export type ProgressStage = z.infer<typeof ProgressStage>
/** A bot's live progress card (progress_card), e.g. a build and deploy; `id` is its message id. */
export const ProgressCard = z.object({
  id: z.string(),
  botId: z.string(),
  /** The run that posted or last updated it: shown inside that run's card. Absent on cards from before. */
  runId: z.string().optional(),
  title: z.string(),
  stages: z.array(ProgressStage),
  percent: z.number().int().min(0).max(100).nullable(),
  detail: z.string().nullable(),
  link: z.object({ label: z.string(), url: z.string() }).nullable(),
  /** From the stages: failed if one failed, done once all are done or skipped, else running. */
  status: z.enum(['running', 'done', 'failed']),
  updatedAt: z.string(),
})
export type ProgressCard = z.infer<typeof ProgressCard>
/** A thread root's replies (plan 话题): count, latest reply, and its first three distinct authors (user or bot ids). */
export const ThreadSummary = z.object({
  replyCount: z.number().int(),
  lastReplyAt: z.string(),
  participants: z.array(z.string()),
  /** The viewer's own state, only on roots of a timeline they load (thread.updated carries the shared part alone). */
  unread: z.number().int().optional(),
  mentioned: z.boolean().optional(),
})
export type ThreadSummary = z.infer<typeof ThreadSummary>
export const MessageDto = z.object({
  id: z.string(),
  seq: z.number().int(),
  groupId: z.string(),
  kind: z.enum(['user', 'bot', 'event']),
  authorId: z.string().nullable(),
  authorName: z.string(),
  body: z.string(),
  /** The sender's idempotency key (SendMessageReq.clientId): its composer swaps its 发送中 row for this message. */
  clientId: z.string().optional(),
  /** Bot ids this message triggers (explicit @; a quote only adds context). */
  mentions: z.array(z.string()),
  /** Member ids it @s (被 @ notifications); always sent by the server. */
  userMentions: z.array(z.string()).optional(),
  runId: z.string().nullable(),
  createdAt: z.string(),
  attachments: z.array(Attachment),
  quote: z
    .object({ kind: z.enum(['message', 'run']), id: z.string(), who: z.string(), text: z.string() })
    .nullable(),
  /** Ordered by first reaction; always sent by the server (optional only for older clients' literals). */
  reactions: z.array(ReactionDto).optional(),
  /** Recalled by its author: body, attachments, quote, mentions and reactions are blanked. Always sent by the server. */
  recalled: z.boolean().optional(),
  /** Came in from the bound Feishu chat; `authorId` is null when the sender has no 共工 account in the group. */
  fromFeishu: z.boolean().optional(),
  /** Last edit by its author; null/absent when never edited. */
  editedAt: z.string().nullable().optional(),
  /** A bot's preview card; its live state is in the group's preview list (group.previews). */
  previewId: z.string().nullable().optional(),
  /** A scheduled task's card; its live state is in the group's schedule list (group.schedules). */
  scheduleId: z.string().nullable().optional(),
  /** Posted by this scheduled task when it fired (in its owner's name). */
  scheduledBy: z.string().nullable().optional(),
  /** Posted by an inbound webhook of this group (in its owner's name; displayed under the webhook's name). */
  webhook: z.object({ id: z.string(), name: z.string() }).optional(),
  /** An event's translatable source; `body` holds its Chinese rendering. */
  i18n: I18nText.optional(),
  /** A force-sync conflict card (F11): the held change and whose replica it is. */
  syncConflict: z.object({ id: z.string(), botId: z.string() }).nullable().optional(),
  /** Legacy 填写密钥 card for an MCP server (before secrets); rendered read-only. */
  mcpSecret: McpSecretCard.optional(),
  /** A bot's 填写密钥 card (secret_request). */
  secretCard: SecretCard.optional(),
  /** A bot's progress card (progress_card), updated in place. */
  progress: ProgressCard.optional(),
  /** A bot reply's answered ```actions blocks, by block id (plan 富交互消息). */
  actions: z.record(z.string(), ActionAnswer).optional(),
  /** Generic card (plan 插件体系-方案); unknown kinds are shown as the body. */
  card: MessageCard.optional(),
  /** Legacy: a page published with html_render as its own message, shown inline in a sandboxed frame. */
  htmlRender: HtmlRenderRef.optional(),
  /** A final reply's pages its run published with html_render: at their ```html-page blocks, the rest after it. */
  htmlRenders: z.array(HtmlRenderRef).optional(),
  /** The canvas selection it was sent with (a member's message about an artifact). */
  canvas: MessageCanvas.optional(),
  /** An event about a failed Feishu call (plain words in `i18n`, Feishu's code shown second). */
  feishuIssue: FeishuIssueEvent.optional(),
  /** A reply in the thread of this root message (plan 话题); null/absent in the main timeline. */
  threadRootId: z.string().nullable().optional(),
  /** A thread reply also shown in the main timeline (同时发送到群). */
  alsoSent: z.boolean().optional(),
  /** Deleted by the viewer (删除): only a thread root with replies still comes back, blanked, as a placeholder. */
  hidden: z.boolean().optional(),
  /** On a root message with replies: their summary. */
  thread: ThreadSummary.optional(),
})
export type MessageDto = z.infer<typeof MessageDto>
/**
 * POST /api/messages/:id/recall (author, own user message, within the window) → the blanked MessageDto.
 * POST /api/messages/:id/hide (author, any time) → 204; hides it from the author only.
 */
export const RECALL_WINDOW_MS = 24 * 3600_000
/** Quote snapshot text of a message that was recalled after being quoted. */
export const RECALLED_QUOTE = '该消息已撤回'
/** PATCH /api/messages/:id (author, own plain user message, within RECALL_WINDOW_MS, same @ targets) → the MessageDto. */
export const EditMessageReq = z.object({ body: z.string().max(20000) })

export const TimelineDto = z.object({ messages: z.array(MessageDto), runs: z.array(RunDto) })
export type TimelineDto = z.infer<typeof TimelineDto>
/**
 * GET /api/unreads → 全部未读: the caller's groups with unread messages, latest first; each with its first unread
 * main-timeline messages (oldest first, up to 20, `more` when there are others).
 */
export const UnreadsDto = z.object({
  groups: z.array(z.object({ group: GroupDto, messages: z.array(MessageDto), more: z.boolean() })),
})
export type UnreadsDto = z.infer<typeof UnreadsDto>

/**
 * Threads (plan 话题). GET /api/messages/:rootId/thread?before= → ThreadDto: the root, a page of replies (oldest first)
 * and their runs. PUT …/thread/read (ThreadReadReq) and …/thread/follow (ThreadFollowReq) → ThreadStateDto.
 */
export const ThreadStateDto = z.object({
  rootId: z.string(),
  groupId: z.string(),
  following: z.boolean(),
  lastReadSeq: z.number().int(),
  /** Replies after lastReadSeq by others. */
  unread: z.number().int(),
  /** One of them @s the viewer. */
  mentioned: z.boolean(),
})
export type ThreadStateDto = z.infer<typeof ThreadStateDto>
export const ThreadDto = z.object({
  root: MessageDto,
  replies: z.array(MessageDto),
  runs: z.array(RunDto),
  state: ThreadStateDto,
})
export type ThreadDto = z.infer<typeof ThreadDto>
export const ThreadReadReq = z.object({ seq: z.number().int().min(0).optional() })
export const ThreadFollowReq = z.object({ following: z.boolean() })
/** GET /api/threads?before=<last reply seq> → ThreadInboxDto: followed threads, latest reply first. */
export const ThreadInboxItemDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  root: MessageDto,
  /** The latest replies, oldest first (at most 2). */
  latest: z.array(MessageDto),
  state: ThreadStateDto,
})
export type ThreadInboxItemDto = z.infer<typeof ThreadInboxItemDto>
export const ThreadInboxQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export const ThreadInboxDto = z.object({ threads: z.array(ThreadInboxItemDto) })
export type ThreadInboxDto = z.infer<typeof ThreadInboxDto>
/**
 * GET /api/groups/:id/threads?cursor=<last reply seq>&limit= → GroupThreadsDto: the group's threads (replies or a bot at
 * work), bots at work first, then latest reply first. `next` is the cursor of the following page; threads with a bot at
 * work come with the first page only.
 */
export const GroupThreadItemDto = z.object({
  root: MessageDto,
  /** The viewer's state; unread counts nothing while they do not follow. */
  state: ThreadStateDto,
  /** A bot is at work in it (queued, running or waiting for an answer). */
  live: z.boolean(),
})
export type GroupThreadItemDto = z.infer<typeof GroupThreadItemDto>
export const GroupThreadsQuery = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export const GroupThreadsDto = z.object({
  threads: z.array(GroupThreadItemDto),
  next: z.number().int().nullable(),
})
export type GroupThreadsDto = z.infer<typeof GroupThreadsDto>
/** GET /api/threads/unread → followed threads with unread replies, and how many of them @ the viewer. */
export const ThreadUnreadDto = z.object({ unread: z.number().int(), mentioned: z.number().int() })
export type ThreadUnreadDto = z.infer<typeof ThreadUnreadDto>

/** 稍后处理: PUT /api/messages/:id/save — save (or re-save) a message, with a reminder or none. */
export const SaveMessageReq = z.object({ remindAt: z.string().datetime({ offset: true }).nullable() })
export type SaveMessageReq = z.infer<typeof SaveMessageReq>
/** PUT /api/messages/:id/save/done — 完成 a saved message, or back to 进行中. */
export const SaveDoneReq = z.object({ done: z.boolean() })
export const SavedMessageDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  message: MessageDto,
  remindAt: z.string().nullable(),
  /** The reminder fired: due until done or re-scheduled. */
  remindedAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  createdAt: z.string(),
})
export type SavedMessageDto = z.infer<typeof SavedMessageDto>
/** GET /api/saved?state=&before= — 进行中 newest saved first, 已完成 newest done first; `before` = the last item's cursor. */
export const SavedListQuery = z.object({
  state: z.enum(['open', 'done']).default('open'),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})
export const SavedListDto = z.object({ items: z.array(SavedMessageDto) })
export type SavedListDto = z.infer<typeof SavedListDto>
/** GET /api/saved/state: the caller's open saved message ids (for the 已收藏 mark) and how many reminders are due. */
export const SavedStateDto = z.object({ ids: z.array(z.string()), due: z.number().int() })
export type SavedStateDto = z.infer<typeof SavedStateDto>

export const SendMessageReq = z.object({
  /** May be empty when the message carries attachments. */
  body: z.string().max(20000),
  /** Client-generated idempotency key; resending the same id returns the original message. */
  clientId: z.string().min(8),
  /** Ids from POST /api/uploads. */
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
  /** Quoting a bot's reply or run card only adds context; @ the bot to trigger it (spec §8.6). */
  quote: z
    .object({ kind: z.enum(['message', 'run']), id: z.string() })
    .nullable()
    .default(null),
  /** 打断并追加 into this running run (trigger user or bot owner only). */
  appendTo: z.string().nullable().default(null),
  /** One-shot model / thought level per mentioned bot id (bot owner or group admin; anyone in a DM). */
  runOptions: z.record(z.string(), RunConfigPick).default({}),
  /** The artifact canvas selection the message is about (plan 原型编辑器 R3). */
  artifactContext: ArtifactContext.optional(),
  /**
   * The artifact open in front in the group's workbench, sent with an @ and no artifactContext: a hint of which one
   * "it" is, never a limit on what the bot may change and never an addressee on its own.
   */
  foregroundArtifactId: z.string().optional(),
  /** Reply in the thread of this root message of the group (plan 话题). */
  threadRootId: z.string().nullable().default(null),
  /** With threadRootId: also show the reply in the main timeline. */
  alsoSent: z.boolean().default(false),
})
