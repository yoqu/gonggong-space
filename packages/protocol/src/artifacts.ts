import { z } from 'zod'
import { SyncHash, SyncPath, syncRootText } from './sync.js'

// ── Artifacts (docs/plan/产物托管与编辑-开发计划.md): server-hosted, versioned design/<slug>/ folders ────

export const ARTIFACT_FILE_MAX_BYTES = 10 * 1024 * 1024
export const ARTIFACT_VERSION_MAX_BYTES = 50 * 1024 * 1024
export const ARTIFACT_MAX_FILES = 500
/** Lint issues a run's context carries about the artifacts it works on. */
export const ARTIFACT_CONTEXT_ISSUES_MAX = 20

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const ArtifactScreenId = z.string().max(40).regex(KEBAB)
/** `design/<slug>`, unique in the group. */
export const ArtifactDir = z.string().regex(/^design\/[a-z0-9][a-z0-9-]{0,63}$/)
/** An editable HTML file: a screen of an L1 artifact, or the single page of an L0 one. */
export const ArtifactHtmlFile = z.string().regex(/^(screens\/[a-z0-9]+(-[a-z0-9]+)*\.html|index\.html)$/)
/** An element of a version's HTML: the start offset of its tag in the stored source, injected as `data-gg-id`. */
export const GgId = z.string().regex(/^\d{1,9}$/)

// ── gg-artifact.json (L1 contract, plugin web-prototype SKILL.md) ───────────
export const ArtifactDevice = z.enum(['miniprogram', 'mobile', 'desktop'])
export type ArtifactDevice = z.infer<typeof ArtifactDevice>
export const GgArtifactScreen = z.object({
  id: ArtifactScreenId,
  title: z.string().min(1).max(80),
  file: z.string(),
  statusBar: z.enum(['light', 'dark']).optional(),
})
export type GgArtifactScreen = z.infer<typeof GgArtifactScreen>
export const GG_ARTIFACT_MANIFEST = 'gg-artifact.json'
export const GgArtifactManifest = z
  .object({
    title: z.string().min(1).max(80),
    device: ArtifactDevice,
    entry: ArtifactScreenId,
    screens: z.array(GgArtifactScreen).min(1).max(100),
  })
  .superRefine((m, ctx) => {
    const ids = new Set<string>()
    for (const [i, s] of m.screens.entries()) {
      if (s.file !== `screens/${s.id}.html`)
        ctx.addIssue({ code: 'custom', path: ['screens', i, 'file'], message: `必须是 screens/${s.id}.html` })
      if (ids.has(s.id))
        ctx.addIssue({ code: 'custom', path: ['screens', i, 'id'], message: `屏幕 id 重复：${s.id}` })
      ids.add(s.id)
    }
    if (!ids.has(m.entry)) ctx.addIssue({ code: 'custom', path: ['entry'], message: `没有屏幕 ${m.entry}` })
  })
export type GgArtifactManifest = z.infer<typeof GgArtifactManifest>

// ── Versions ────────────────────────────────────────────────────────────────
/** No dot-file segment and no `node_modules`: the daemon never uploads them and refuses to check them out. */
const ArtifactPath = SyncPath.refine(
  (p) => p.split('/').every((s) => !s.startsWith('.') && s !== 'node_modules'),
  {
    message: '路径无效',
  },
)
export const ArtifactFile = z.object({
  path: ArtifactPath,
  hash: SyncHash,
  size: z.number().int().min(0).max(ARTIFACT_FILE_MAX_BYTES),
})
export type ArtifactFile = z.infer<typeof ArtifactFile>
/** At most ARTIFACT_MAX_FILES unique paths totalling ARTIFACT_VERSION_MAX_BYTES. */
export const ArtifactFiles = z
  .array(ArtifactFile)
  .max(ARTIFACT_MAX_FILES)
  .superRefine((files, ctx) => {
    if (new Set(files.map((f) => f.path)).size !== files.length)
      ctx.addIssue({ code: 'custom', message: '路径重复' })
    if (files.reduce((n, f) => n + f.size, 0) > ARTIFACT_VERSION_MAX_BYTES)
      ctx.addIssue({ code: 'custom', message: '超出单版大小上限' })
  })

/**
 * What a version's `digest` is the sha256 of: the sync root text (`syncRootText`) of its files with `exec` false, so
 * the daemon reuses its sync root hash to tell whether its local copy matches.
 */
export const artifactDigestText = (files: readonly { path: string; hash: string }[]) =>
  syncRootText(files.map((f) => ({ path: f.path, hash: f.hash, exec: false })))

/** A design-rule finding of a version (never blocks it); the next run's context lists them for the agent to fix. */
export const LintIssue = z.object({
  code: z.string(),
  file: z.string().optional(),
  message: z.string(),
  severity: z.literal('warn'),
})
export type LintIssue = z.infer<typeof LintIssue>

/** `run`: uploaded after a run; `edit`: the panel's direct edits; `local`: changes found on the machine before a run. */
export const ArtifactVersionSource = z.enum(['run', 'edit', 'local'])
export type ArtifactVersionSource = z.infer<typeof ArtifactVersionSource>
export const ArtifactVersionDto = z.object({
  id: z.string(),
  artifactId: z.string(),
  /** 1, 2, … within the artifact. */
  n: z.number().int().min(1),
  parentVersionId: z.string().nullable(),
  source: ArtifactVersionSource,
  runId: z.string().nullable(),
  userId: z.string().nullable(),
  files: z.array(ArtifactFile),
  digest: SyncHash,
  thumbnailUrl: z.string().nullable(),
  /** Its parent was not the head when it was submitted: a candidate a member adopts or hands to the AI to merge. */
  stale: z.boolean(),
  issues: z.array(LintIssue),
  createdAt: z.string(),
  /** The bot of `runId` or the user of `userId`. */
  authorName: z.string().nullable(),
})
export type ArtifactVersionDto = z.infer<typeof ArtifactVersionDto>
export const ArtifactVersionSummary = ArtifactVersionDto.omit({ files: true })
export type ArtifactVersionSummary = z.infer<typeof ArtifactVersionSummary>
/** A `data-gg-link` of a screen: `to` may name a screen that does not exist (a lint issue). */
export const ArtifactLink = z.object({
  from: ArtifactScreenId,
  to: z.string(),
  /** The linking element (its `data-gg-id`). */
  ggId: GgId,
  /** Its text, trimmed and truncated. */
  text: z.string(),
})
export type ArtifactLink = z.infer<typeof ArtifactLink>
/**
 * GET /api/artifacts/:id/versions/:versionId — with its own gg-artifact.json (null for L0 or an invalid one) and the
 * links between its screens (empty for L0).
 */
export const ArtifactVersionDetail = ArtifactVersionDto.extend({
  manifest: GgArtifactManifest.nullable(),
  links: z.array(ArtifactLink),
})
export type ArtifactVersionDetail = z.infer<typeof ArtifactVersionDetail>

export const ArtifactDto = z.object({
  id: z.string(),
  groupId: z.string(),
  title: z.string(),
  dir: ArtifactDir,
  pluginId: z.string().nullable(),
  pluginVersionId: z.string().nullable(),
  designSystemId: z.string().nullable(),
  /** null until the first version arrives. */
  headVersionId: z.string().nullable(),
  head: ArtifactVersionSummary.nullable().optional(),
  /** The head's gg-artifact.json; absent for L0 artifacts (rendered from index.html). */
  manifest: GgArtifactManifest.nullable().optional(),
  /**
   * Undo / Redo targets for POST …/versions/:versionId/restore, which only moves the head: the head's parent, and the
   * latest non-stale version whose parent is the head. Sent by GET /api/artifacts/:id.
   */
  undoVersionId: z.string().nullable().optional(),
  redoVersionId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  /** A run is working on it: the panel is read-only until it ends. */
  running: z.boolean(),
  /** Starred screen ids (PUT /api/artifacts/:id/favorites); not versioned. */
  favorites: z.array(z.string()),
})
export type ArtifactDto = z.infer<typeof ArtifactDto>

/** The artifact card (message `card`), updated in place as versions arrive. */
export const ArtifactCard = z.object({
  type: z.literal('artifact'),
  artifactId: z.string(),
  title: z.string(),
  /** The head's `n`; null while the first version is being generated. */
  versionN: z.number().int().nullable(),
  status: z.enum(['generating', 'ready', 'stale-candidate']),
  thumbnailUrl: z.string().nullable(),
  issueCount: z.number().int().min(0),
})
export type ArtifactCard = z.infer<typeof ArtifactCard>

// ── Direct edits (3.5): spliced into the source by offset, one new version per save ──
export const STYLE_PROPS = [
  'color',
  'background',
  'background-color',
  'border-color',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'border',
  'border-width',
  'border-style',
  'border-radius',
  'width',
  'height',
  'opacity',
] as const
export const StyleProp = z.enum(STYLE_PROPS)
export type StyleProp = z.infer<typeof StyleProp>
/** Colours come from the tokens only, so manual edits pass the design-rule lint too. */
const COLOR_PROPS = new Set<string>(['color', 'background', 'background-color', 'border-color'])
const COLOR_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset'])
const STYLE_KEYWORDS = new Set([
  ...COLOR_KEYWORDS,
  'auto',
  'none',
  'normal',
  'solid',
  'dashed',
  'dotted',
  'bold',
  'bolder',
  'lighter',
  'left',
  'right',
  'center',
  'justify',
  'start',
  'end',
])
const VAR = /^var\(--[a-z0-9-]+\)$/
const NUMBER = /^-?(\d+|\d*\.\d+)(px|rem|em|%|vh|vw)?$/
const UNSAFE_CSS = /url\(|expression|[;"'\\<>{}!]|\/\*/i

/** An inline style value: space-separated token references (`var(--x)`), numbers with a unit, or keywords. */
export function styleValueOk(value: string, prop?: string) {
  if (value.length > 200 || UNSAFE_CSS.test(value)) return false
  const parts = value.trim().split(/\s+/)
  if (prop && COLOR_PROPS.has(prop)) return parts.every((p) => VAR.test(p) || COLOR_KEYWORDS.has(p))
  return parts.every((p) => VAR.test(p) || NUMBER.test(p) || STYLE_KEYWORDS.has(p))
}

/** A `:root` custom property value in tokens.css: anything that cannot leave the declaration. */
export function tokenValueOk(value: string) {
  if (!value.trim() || value.length > 200 || /url\(|expression|[;\\<>{}]|\/\*/i.test(value)) return false
  return (
    [...value].filter((c) => c === '"').length % 2 === 0 &&
    [...value].filter((c) => c === "'").length % 2 === 0
  )
}

export const ArtifactTransition = z.enum(['none', 'push', 'slide-up', 'fade'])
export type ArtifactTransition = z.infer<typeof ArtifactTransition>
export const EditableAttr = z.enum(['src', 'href', 'alt', 'data-gg-link', 'data-gg-transition'])
export type EditableAttr = z.infer<typeof EditableAttr>
const RELATIVE_URL = /^(?![a-z][a-z0-9+.-]*:)(?![/\\])[^\s"'<>\\`]+$/i
const HTTP_URL = /^https?:\/\/[^\s"'<>\\`]+$/i
export function attrValueOk(name: EditableAttr, value: string) {
  switch (name) {
    case 'src':
      return value.length <= 500 && RELATIVE_URL.test(value)
    case 'href':
      return value.length <= 2000 && (RELATIVE_URL.test(value) || HTTP_URL.test(value))
    case 'alt':
      return value.length <= 500
    case 'data-gg-link':
      return ArtifactScreenId.safeParse(value).success
    case 'data-gg-transition':
      return ArtifactTransition.safeParse(value).success
  }
}

const At = { file: ArtifactHtmlFile, ggId: GgId }
export const ArtifactEditOp = z.discriminatedUnion('kind', [
  /** Replaces the text of an element without child elements; HTML-escaped by the server. */
  z.object({ kind: z.literal('text'), ...At, text: z.string().max(5000) }),
  /** `value` null removes the attribute. */
  z
    .object({ kind: z.literal('attr'), ...At, name: EditableAttr, value: z.string().nullable() })
    .refine((o) => o.value === null || attrValueOk(o.name, o.value), {
      message: '属性值不合法',
      path: ['value'],
    }),
  /** Merged into the inline style; an empty value removes the property. */
  z
    .object({ kind: z.literal('style'), ...At, props: z.partialRecord(StyleProp, z.string()) })
    .superRefine((o, ctx) => {
      const entries = Object.entries(o.props)
      if (entries.length === 0) ctx.addIssue({ code: 'custom', path: ['props'], message: '没有样式' })
      for (const [k, v] of entries)
        if (v !== '' && !styleValueOk(v ?? '', k))
          ctx.addIssue({ code: 'custom', path: ['props', k], message: '样式值不合法' })
    }),
  /** An existing `--x` under `:root` in tokens.css. */
  z
    .object({ kind: z.literal('token'), name: z.string().regex(/^--[a-z0-9-]{1,64}$/), value: z.string() })
    .refine((o) => tokenValueOk(o.value), { message: '令牌值不合法', path: ['value'] }),
  z.object({ kind: z.literal('delete'), ...At }),
  /** An uploaded image copied into `assets/`; the element's `src` points at it. */
  z.object({ kind: z.literal('asset'), ...At, uploadId: z.string() }),
  /** Screen operations on gg-artifact.json (`duplicate` also copies the screen file). */
  z
    .object({
      kind: z.literal('manifest'),
      op: z.enum(['rename', 'duplicate', 'delete', 'reorder']),
      screenId: ArtifactScreenId,
      title: z.string().min(1).max(80).optional(),
      /** The screen's new position (`reorder`). */
      index: z.number().int().min(0).optional(),
    })
    .superRefine((o, ctx) => {
      if (o.op === 'rename' && o.title === undefined)
        ctx.addIssue({ code: 'custom', path: ['title'], message: '缺少标题' })
      if (o.op === 'reorder' && o.index === undefined)
        ctx.addIssue({ code: 'custom', path: ['index'], message: '缺少位置' })
    }),
])
export type ArtifactEditOp = z.infer<typeof ArtifactEditOp>
/** POST /api/artifacts/:id/edits — 409 when `baseVersionId` is not the head. */
export const ArtifactEditReq = z.object({
  baseVersionId: z.string(),
  ops: z.array(ArtifactEditOp).min(1).max(50),
})
export type ArtifactEditReq = z.infer<typeof ArtifactEditReq>

/** PUT /api/artifacts/:id/favorites — replaces the starred screens. */
export const ArtifactFavoritesReq = z.object({ screenIds: z.array(ArtifactScreenId).max(100) })
export type ArtifactFavoritesReq = z.infer<typeof ArtifactFavoritesReq>

/** POST /api/artifacts/:id/uploads takes one image as the raw body (Content-Type below); SVG is refused. */
export const ARTIFACT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
export const ARTIFACT_UPLOAD_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const
/** `uploadId` goes into an `asset` op, which writes the image to `path` and points the element's `src` at it. */
export const ArtifactUploadRes = z.object({ uploadId: z.string(), path: z.string() })
export type ArtifactUploadRes = z.infer<typeof ArtifactUploadRes>

// ── Annotations ─────────────────────────────────────────────────────────────
export const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
export type Rect = z.infer<typeof Rect>
export const AnnotationStatus = z.enum(['open', 'sent', 'resolved'])
export type AnnotationStatus = z.infer<typeof AnnotationStatus>
/** POST /api/artifacts/:id/annotations (GET …?version=<id> lists them) — `ggId` null: an element scripts generated (annotate only, no edits). */
export const CreateAnnotationReq = z.object({
  versionId: z.string(),
  file: ArtifactHtmlFile,
  ggId: GgId.nullable(),
  selector: z.string().max(500),
  rect: Rect,
  /** The element's outer HTML, truncated. */
  snippet: z.string().max(2000),
  note: z.string().min(1).max(2000),
})
export type CreateAnnotationReq = z.infer<typeof CreateAnnotationReq>
/** PATCH /api/annotations/:id (DELETE the same path removes it). */
export const UpdateAnnotationReq = z.object({
  note: z.string().min(1).max(2000).optional(),
  status: AnnotationStatus.optional(),
})
export type UpdateAnnotationReq = z.infer<typeof UpdateAnnotationReq>
export const AnnotationDto = CreateAnnotationReq.extend({
  id: z.string(),
  artifactId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  status: AnnotationStatus,
  createdAt: z.string(),
})
export type AnnotationDto = z.infer<typeof AnnotationDto>
/**
 * POST /api/artifacts/:id/annotations/send — posts an @bot message as the user (answers its MessageDto); the
 * annotations become `sent`.
 */
export const SendAnnotationsReq = z.object({
  annotationIds: z.array(z.string()).min(1).max(50),
  botId: z.string(),
  extra: z.string().max(2000).optional(),
})
export type SendAnnotationsReq = z.infer<typeof SendAnnotationsReq>

// ── Bridge (3.4): main site ⇄ each screen iframe via postMessage, exact origins both ways ──
/**
 * The server injects `/__gg/bridge.js` into the screens (and an L0 `index.html`) a member's preview serves, with the
 * main site's origin in `data-gg-parent`; shared links and the shell get none. Every element of the stored source
 * carries `data-gg-id`. The screen posts to that origin only and takes messages only from it and from `parent`.
 * Screens are AI-written pages in the same window as the bridge, so the main site treats what they post as untrusted
 * UI hints (it validates them with these schemas and never renders their strings as HTML).
 */
export const BRIDGE_SCRIPT_PATH = '/__gg/bridge.js'
export const BridgeMode = z.enum(['preview', 'mark', 'edit'])
export type BridgeMode = z.infer<typeof BridgeMode>
/** Main site → screen. */
export const BridgeToShell = z.discriminatedUnion('type', [
  /** `mark` / `edit`: clicks select elements (links and forms do nothing); `preview`: `data-gg-link` clicks post `nav`. */
  z.object({ type: z.literal('mode'), mode: BridgeMode }),
  /** Outlines these elements (annotated ones, say); an empty list clears them. */
  z.object({ type: z.literal('highlight'), ggIds: z.array(GgId).max(500) }),
  z.object({ type: z.literal('select-clear') }),
  z.object({ type: z.literal('scroll-to'), ggId: GgId }),
  z.object({ type: z.literal('reload') }),
])
export type BridgeToShell = z.infer<typeof BridgeToShell>
const FromScreen = { source: z.literal('gg-bridge'), file: ArtifactHtmlFile }
/** Element rects are in the screen's viewport (its iframe), in CSS pixels. */
export const BridgeFromShell = z.discriminatedUnion('type', [
  /** On load, then `size` whenever the document's size changes (the canvas sizes the iframe to it). */
  z.object({ ...FromScreen, type: z.literal('ready'), width: z.number(), height: z.number() }),
  z.object({ ...FromScreen, type: z.literal('size'), width: z.number(), height: z.number() }),
  /** `ggId` and `rect` null when the pointer leaves the elements. */
  z.object({ ...FromScreen, type: z.literal('hover'), ggId: GgId.nullable(), rect: Rect.nullable() }),
  z.object({
    ...FromScreen,
    type: z.literal('select'),
    /** null: an element scripts made (annotate only). */
    ggId: GgId.nullable(),
    selector: z.string(),
    rect: Rect,
    tag: z.string(),
    text: z.string(),
    /** No child elements: a `text` edit applies. */
    textOnly: z.boolean(),
    /** color, background-color, font-size, font-weight, line-height, padding, margin, border-radius, width, height. */
    computed: z.record(z.string(), z.string()),
    inlineStyle: z.string(),
    src: z.string().nullable(),
    href: z.string().nullable(),
    /** `data-gg-link`. */
    link: z.string().nullable(),
  }),
  /** Preview mode: a `data-gg-link` element was clicked. */
  z.object({ ...FromScreen, type: z.literal('nav'), screen: z.string() }),
  /** Preview mode: a `data-gg-back` element was clicked. */
  z.object({ ...FromScreen, type: z.literal('back') }),
])
export type BridgeFromShell = z.infer<typeof BridgeFromShell>

// ── Daemon ──────────────────────────────────────────────────────────────────
/** An artifact a run checks out before the agent starts (RunStart.artifacts). */
export const DaemonArtifactRef = z.object({
  id: z.string(),
  dir: ArtifactDir,
  headVersionId: z.string().nullable(),
  digest: SyncHash.nullable(),
})
export type DaemonArtifactRef = z.infer<typeof DaemonArtifactRef>
/** GET /api/daemon/artifacts/:id/versions/:versionId */
export const ArtifactManifestRes = z.object({ versionId: z.string(), files: z.array(ArtifactFile) })
export type ArtifactManifestRes = z.infer<typeof ArtifactManifestRes>
/** POST /api/daemon/runs/:runId/artifacts/:id/versions — every blob uploaded first; `submitKey` makes retries idempotent. */
export const ArtifactSubmitReq = z.object({
  parentVersionId: z.string().nullable(),
  /** `local`: changes found on the machine before the run started (uploaded before the head is checked out). */
  source: z.enum(['run', 'local']).default('run'),
  submitKey: z.uuid(),
  files: ArtifactFiles,
})
export type ArtifactSubmitReq = z.infer<typeof ArtifactSubmitReq>
/** `head` false with `stale` true: kept as a candidate, the head moved on meanwhile. */
export const ArtifactSubmitRes = z.object({
  versionId: z.string(),
  n: z.number().int().min(1),
  head: z.boolean(),
  stale: z.boolean(),
})
export type ArtifactSubmitRes = z.infer<typeof ArtifactSubmitRes>

/** Instruction templates turned into @bot messages with the selection as context (R3). */
export const ArtifactCommand = z.enum([
  'variations',
  'regenerate',
  'desktop-version',
  'missing-states',
  'animate',
  'accessibility-audit',
  'instant-prototype',
  'app-store-assets',
  'web-assets',
  'marketing-kit',
  'logo',
  'image',
  'diagram',
  'project-brief',
  'edit-with-ai',
])
export type ArtifactCommand = z.infer<typeof ArtifactCommand>

/** An element of a screen, by `(file, ggId)` in the head version. */
export const ArtifactElementRef = z.object({ file: ArtifactHtmlFile, ggId: GgId })
export type ArtifactElementRef = z.infer<typeof ArtifactElementRef>

/**
 * POST /api/artifacts/:id/commands — posts an @bot message as the user with the instruction for `command` and the
 * selection (answers its MessageDto). `count`: how many variations (default 3); `text`: the request (needed by
 * `edit-with-ai`, which also needs `ggIds`).
 */
export const ArtifactCommandReq = z
  .object({
    command: ArtifactCommand,
    botId: z.string(),
    screenIds: z.array(ArtifactScreenId).max(100).optional(),
    ggIds: z.array(ArtifactElementRef).max(50).optional(),
    text: z.string().max(2000).optional(),
    count: z.number().int().min(1).max(5).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.command !== 'edit-with-ai') return
    if (!r.text?.trim()) ctx.addIssue({ code: 'custom', path: ['text'], message: '缺少修改要求' })
    if (!r.ggIds?.length) ctx.addIssue({ code: 'custom', path: ['ggIds'], message: '没有选中元素' })
  })
export type ArtifactCommandReq = z.infer<typeof ArtifactCommandReq>

/**
 * SendMessageReq.artifactContext — what the canvas has selected when a member sends from the group composer: the
 * message refers to the artifact (its run checks it out) and the agent reads the selection after the text.
 */
export const ArtifactContext = z.object({
  artifactId: z.string(),
  screenIds: z.array(ArtifactScreenId).max(100).optional(),
  elements: z
    .array(ArtifactElementRef.extend({ label: z.string().max(200) }))
    .max(20)
    .optional(),
})
export type ArtifactContext = z.infer<typeof ArtifactContext>
