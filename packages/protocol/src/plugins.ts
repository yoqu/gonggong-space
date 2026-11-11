import { z } from 'zod'
import { ArtifactCard } from './artifacts.js'
import { AgentKind } from './common.js'
import { ProviderPreset, SkillFile } from './daemon.js'

// ── Plugins (plan 插件体系-方案): a folder with a manifest, layered like team skills ────
/** The manifest at the root of a plugin folder; the rest is a Claude plugin layout (`skills/<name>/SKILL.md`). */
export const PLUGIN_MANIFEST = 'gonggong-plugin.json'
export const PLUGIN_MAX_BYTES = 5 * 1024 * 1024
export const PLUGIN_MAX_FILES = 600
const SEMVER = /^\d+\.\d+\.\d+$/
const ID = /^[a-z][a-z0-9-]{0,39}$/
const HEX = /^#[0-9a-fA-F]{6}$/
/** A path inside the plugin folder. */
const PkgPath = z
  .string()
  .min(1)
  .max(255)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), '必须是插件目录内的相对路径')

export const PluginCategory = z.enum(['web', 'deck', 'poster', 'dashboard', 'video', 'tool', 'other'])
export type PluginCategory = z.infer<typeof PluginCategory>

/** A form field of the creation panel (第 3 步「内容与参数」); its value is passed to the agent as `label：value`. */
export const PluginInput = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  label: z.string().min(1).max(40),
  type: z.enum(['string', 'text', 'select', 'boolean']),
  required: z.boolean().default(false),
  /** Choices of a `select`. */
  options: z.array(z.string().min(1).max(40)).max(12).default([]),
  default: z
    .union([z.string().max(2000), z.boolean()])
    .nullable()
    .default(null),
  placeholder: z.string().max(80).nullable().default(null),
  /**
   * A design source (pasted DESIGN.md, reference site or repository): when filled in, the creation panel greys out
   * the preset and the agent is told to build the design system from it.
   */
  designSource: z.boolean().default(false),
})
export type PluginInput = z.infer<typeof PluginInput>

export const PluginTemplate = z.object({
  id: z.string().regex(ID),
  title: z.string().min(1).max(40),
  description: z.string().max(120).default(''),
  /** A label the creation panel groups templates under; ungrouped ones form one unnamed group. */
  group: z.string().min(1).max(20).nullable().default(null),
  /** An image in the folder shown on the template card; null = a placeholder. */
  preview: PkgPath.nullable().default(null),
  /** Ids of the manifest inputs this template asks for; null = all of them. */
  inputs: z.array(z.string()).max(12).nullable().default(null),
  /** False when the template brings its own look: the panel skips the design system step. */
  designSystem: z.boolean().default(true),
})
export type PluginTemplate = z.infer<typeof PluginTemplate>

/** A design system shipped by the plugin: `dir` (inside the entry skill folder) holds DESIGN.md and tokens.css. */
export const PluginDesignSystem = z.object({
  id: z.string().regex(ID),
  title: z.string().min(1).max(40),
  description: z.string().max(120).default(''),
  /** A label the creation panel filters design systems by. */
  category: z.string().min(1).max(20).nullable().default(null),
  /** 2–6 colours for the picker. */
  swatches: z.array(z.string().regex(HEX)).min(2).max(6),
  dir: PkgPath,
})
export type PluginDesignSystem = z.infer<typeof PluginDesignSystem>

/**
 * What a plugin may do beyond giving skills (plan 插件扩展点 §9), listed on install and review: `exec` runs its code
 * (stdio MCP servers) on the executing machine, `network` sends tool calls to the addresses it declares (http MCP).
 */
export const PluginPermission = z.enum(['exec', 'network'])
export type PluginPermission = z.infer<typeof PluginPermission>

const PLUGIN_SECRET_REF = /\$\{secret:([A-Z][A-Z0-9_]{1,63})\}/g
const McpValues = z.record(z.string().min(1).max(100), z.string().max(2000)).default({})
/**
 * An MCP server the plugin brings (`contributes.mcp`), given to the agent as `<plugin>-<name>`. In `command`, `{node}`
 * is the daemon's Node and `{pkg}` the unpacked plugin folder (absolute); env and header values may hold
 * `${secret:NAME}` of the manifest's `secrets`.
 */
export const PluginMcp = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    name: z.string().regex(ID),
    command: z.array(z.string().min(1).max(500)).min(1).max(30),
    env: McpValues,
  }),
  z.object({
    transport: z.literal('http'),
    name: z.string().regex(ID),
    url: z.string().url().max(500),
    headers: McpValues,
  }),
])
export type PluginMcp = z.infer<typeof PluginMcp>

export const PLUGIN_COMMAND_NAME = /^[a-z][a-z0-9-]{0,39}$/
/**
 * A command the plugin adds (plan 插件扩展点 §7), pure declaration. `chat`: `/<name>` in the composer, sent to the agent
 * as `prompt` with `{args}` replaced by what follows the command, using the plugin's entry skill. `artifact`: in the
 * canvas 生成 and `/` menus of this plugin's artifacts; `{dir}` is the artifact folder and the member's request follows.
 */
export const PluginCommand = z.object({
  name: z.string().regex(PLUGIN_COMMAND_NAME),
  title: z.string().min(1).max(20),
  description: z.string().max(120).default(''),
  prompt: z.string().min(1).max(4000),
  where: z.enum(['chat', 'artifact']).default('chat'),
  /** Artifact commands: off until screens are selected. */
  needsScreen: z.boolean().default(false),
})
export type PluginCommand = z.infer<typeof PluginCommand>

/** Extension points (plan 插件扩展点); each optional. */
export const PluginContributes = z.object({
  mcp: z.array(PluginMcp).max(10).default([]),
  commands: z.array(PluginCommand).max(30).default([]),
  /** Provider presets (§6): platform-layer plugins only; added to every daemon's built-in ones, same id replacing. */
  providers: z.array(ProviderPreset).max(300).default([]),
})
export type PluginContributes = z.infer<typeof PluginContributes>

/** The permissions what a manifest contributes needs; it must declare exactly these. */
export const requiredPermissions = (c: PluginContributes): PluginPermission[] =>
  PluginPermission.options.filter((p) => c.mcp.some((m) => m.transport === (p === 'exec' ? 'stdio' : 'http')))

/** Runs code on the executing machine (§9): needs 插件代码 on, the machine owner's consent and a pinned install. */
export const pluginRunsCode = (m: { permissions: PluginPermission[] }) => m.permissions.includes('exec')

export const PluginManifest = z
  .object({
    name: z.string().regex(ID),
    version: z.string().regex(SEMVER),
    title: z.string().min(1).max(40),
    description: z.string().min(1).max(200),
    category: PluginCategory,
    /** Agents the plugin works with; bots on other agents cannot use it. */
    agents: z.array(AgentKind).min(1),
    /** Oldest daemon version that can load it (daemons also need the `plugins` feature). */
    minDaemon: z.string().regex(SEMVER),
    /** The skill a creation invokes: `skills/<entry>/SKILL.md` must exist. Null for a plugin without one (tools only). */
    entry: z.string().regex(ID).nullable().default(null),
    permissions: z.array(PluginPermission).max(PluginPermission.options.length).default([]),
    contributes: PluginContributes.default({ mcp: [], commands: [], providers: [] }),
    /** The plugin's tile: an svg or png in the folder; absent: its category's glyph. */
    icon: PkgPath.optional(),
    templates: z.array(PluginTemplate).max(80).default([]),
    designSystems: z.array(PluginDesignSystem).max(80).default([]),
    inputs: z.array(PluginInput).max(12).default([]),
    /** Env var names of secrets it needs (plan 团队密钥-方案); runs without them do not get the plugin. */
    secrets: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/))
      .max(10)
      .default([]),
    /** Optional (plan Skill市场 D11): left out rather than made up. */
    license: z.string().min(1).max(40).optional(),
    /**
     * Prompt-first creation (Stitch style): one box fills the `prompt` text input; the template's select inputs sit in
     * its toolbar, the design system is a preset, 自动 or one the group imported. Null = the step-by-step panel.
     */
    composer: z.object({ prompt: z.string() }).nullable().default(null),
    /** Hosted-artifact features: `editable` shows direct editing, `tokens` (e.g. `tokens.css`) the theme panel. */
    artifact: z
      .object({
        editable: z.boolean().optional(),
        tokens: PkgPath.optional(),
        /** The L1 shell: a folder with `index.html` (served as `/`) and runtime files (`/_gg/*`); default `skills/<entry>/kit`. */
        kit: PkgPath.optional(),
      })
      .optional(),
    /** Where it came from, shown with the license (e.g. an open-design template at a pinned commit). */
    source: z
      .object({
        name: z.string().max(80),
        url: z.string().url(),
        revision: z.string().max(64).nullable().default(null),
      })
      .nullable()
      .default(null),
  })
  .superRefine((m, ctx) => {
    const ids = new Set(m.inputs.map((i) => i.id))
    for (const [k, tpl] of m.templates.entries())
      for (const id of tpl.inputs ?? [])
        if (!ids.has(id))
          ctx.addIssue({ code: 'custom', path: ['templates', k, 'inputs'], message: `没有输入项 ${id}` })
    if (m.composer && m.inputs.find((i) => i.id === m.composer?.prompt)?.type !== 'text')
      ctx.addIssue({ code: 'custom', path: ['composer', 'prompt'], message: '必须是一个 text 输入项' })
    if (!m.entry && (m.templates.length || m.designSystems.length || m.inputs.length || m.composer))
      ctx.addIssue({ code: 'custom', path: ['entry'], message: '有模板、设计系统或输入项时必须填写' })
    const need = requiredPermissions(m.contributes)
    if (need.join() !== [...new Set(m.permissions)].sort().join())
      ctx.addIssue({ code: 'custom', path: ['permissions'], message: `必须正好是 [${need.join(', ')}]` })
    const names = m.contributes.mcp.map((c) => c.name)
    for (const [k, c] of m.contributes.mcp.entries()) {
      if (names.indexOf(c.name) !== k)
        ctx.addIssue({ code: 'custom', path: ['contributes', 'mcp', k, 'name'], message: `重名 ${c.name}` })
      const values = Object.values(c.transport === 'stdio' ? c.env : c.headers)
      for (const v of values)
        for (const [, name] of v.matchAll(PLUGIN_SECRET_REF))
          if (!m.secrets.includes(name!))
            ctx.addIssue({
              code: 'custom',
              path: ['contributes', 'mcp', k],
              message: `${name} 不在 secrets 里`,
            })
    }
  })
export type PluginManifest = z.infer<typeof PluginManifest>

/** The inputs a creation from `tpl` asks for, in manifest order. */
export const templateInputs = (m: PluginManifest, tpl: PluginTemplate | null | undefined) => {
  const only = tpl?.inputs
  return only ? m.inputs.filter((i) => only.includes(i.id)) : m.inputs
}

/** Whether a creation from `tpl` picks a design system. */
export const usesDesignSystem = (m: PluginManifest, tpl: PluginTemplate | null | undefined) =>
  m.designSystems.length > 0 && tpl?.designSystem !== false

export type CreationStep = 'template' | 'design' | 'content' | 'bot'
/** The creation panel's steps: 交给谁 folds into the last step when exactly one bot can take it. */
export const creationSteps = (
  m: PluginManifest,
  tpl: PluginTemplate | null | undefined,
  usableBots: number,
): CreationStep[] => [
  'template',
  ...(usesDesignSystem(m, tpl) ? (['design'] as const) : []),
  'content',
  ...(usableBots === 1 ? [] : (['bot'] as const)),
]

export const PluginLayer = z.enum(['platform', 'team', 'group'])
export type PluginLayer = z.infer<typeof PluginLayer>

/** A plugin of a layer; the manifest is its current version's. */
export const PluginDto = z.object({
  id: z.string(),
  layer: PluginLayer,
  manifest: PluginManifest,
  versionId: z.string(),
  /** Increments with every upload, independent of `manifest.version`. */
  revision: z.number().int(),
  size: z.number().int(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
  /** Shipped with the server and installed on the platform layer at startup: no upload over it, no delete. */
  builtin: z.boolean(),
})
export type PluginDto = z.infer<typeof PluginDto>
export const PluginFiles = z.array(SkillFile).min(1).max(PLUGIN_MAX_FILES)
/** POST /api/{platform|teams/:teamId|groups/:groupId}/plugins — a new plugin, or a new version of the same `name`. */
export const UploadPluginReq = z.object({ files: PluginFiles })
export type UploadPluginReq = z.infer<typeof UploadPluginReq>

/** Why a bot of the group cannot use a plugin now. */
/** `code`: it runs code and 插件代码 is off; `trust`: the machine's owner has not allowed this version yet. */
export const PluginBlocker = z.enum(['agent', 'daemon', 'offline', 'secret', 'code', 'trust'])
export type PluginBlocker = z.infer<typeof PluginBlocker>
/**
 * GET /api/groups/:id/plugins — platform, team and group plugins with the group's switch. Plugins are off in a group
 * until its admin turns them on (no impact on groups that never do).
 */
export const GroupPluginDto = PluginDto.extend({
  enabledInGroup: z.boolean(),
  bots: z.array(z.object({ botId: z.string(), blocker: PluginBlocker.nullable() })),
})
export type GroupPluginDto = z.infer<typeof GroupPluginDto>
/** PUT /api/groups/:id/plugins/:pluginId */
export const TogglePluginReq = z.object({ enabled: z.boolean() })

/**
 * A machine owner's decision on running a plugin version's code there (plan 插件扩展点 §9): asked the first time a turn
 * on the machine would use it; a new version asks again.
 */
export const PluginTrustStatus = z.enum(['pending', 'allowed', 'denied'])
export type PluginTrustStatus = z.infer<typeof PluginTrustStatus>
/** GET /api/machines/:id/plugin-trusts */
export const PluginTrustDto = z.object({
  id: z.string(),
  machineId: z.string(),
  pluginId: z.string(),
  pluginName: z.string(),
  pluginTitle: z.string(),
  version: z.string(),
  versionId: z.string(),
  permissions: z.array(PluginPermission),
  mcp: z.array(PluginMcp),
  status: PluginTrustStatus,
  requestedAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
})
export type PluginTrustDto = z.infer<typeof PluginTrustDto>
/** PUT /api/machines/:id/plugin-trusts/:trustId; DELETE revokes it (the next turn asks again). */
export const DecidePluginTrustReq = z.object({ allow: z.boolean() })

export const CREATION_INPUT_MAX = 20000

/** CreationReq.designSystemId: the agent picks a preset that fits the request. */
export const AUTO_DESIGN_SYSTEM = 'auto'
const GROUP_DS = 'group:'
/** CreationReq.designSystemId of a design system the group imported. */
export const groupDesignSystemKey = (id: string) => `${GROUP_DS}${id}`
export const groupDesignSystemId = (key: string | null) =>
  key?.startsWith(GROUP_DS) ? key.slice(GROUP_DS.length) : null

const frontMatter = (md: string) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1] ?? ''
/** A DESIGN.md's name: the front matter `name`, else its first `#` heading. */
export function designMdTitle(md: string) {
  const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(frontMatter(md))?.[1]
  return (name ?? /^#\s+(.+?)\s*$/m.exec(md)?.[1])?.slice(0, 40) ?? null
}
/** Up to five hex colours of the front matter, in order: the picker's swatches. */
export const designMdSwatches = (md: string) =>
  (frontMatter(md).match(/#[0-9a-fA-F]{6}\b/g) ?? []).slice(0, 5)

/**
 * A design system the group imported (「导入我的设计」): a DESIGN.md, or a site or repository the agent extracts one
 * from at each creation. Offered by prompt-first plugins next to their presets.
 */
export const GroupDesignSystemDto = z.object({
  id: z.string(),
  groupId: z.string(),
  title: z.string(),
  swatches: z.array(z.string()),
  designMd: z.string().nullable(),
  url: z.string().nullable(),
  repo: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
})
export type GroupDesignSystemDto = z.infer<typeof GroupDesignSystemDto>
/** POST /api/groups/:id/design-systems */
export const CreateGroupDesignSystemReq = z
  .object({
    designMd: z.string().trim().min(1).max(CREATION_INPUT_MAX).optional(),
    url: z.string().trim().url().max(500).optional(),
    repo: z.string().trim().min(1).max(500).optional(),
  })
  .refine((r) => r.designMd || r.url || r.repo, '请粘贴 DESIGN.md，或填写参考网站、参考仓库')
export type CreateGroupDesignSystemReq = z.infer<typeof CreateGroupDesignSystemReq>
/** POST /api/groups/:id/creations — the creation panel's 「交给 AI」. Posts a creation card @-ing the bot. */
export const CreationReq = z.object({
  pluginId: z.string(),
  templateId: z.string().nullable(),
  designSystemId: z.string().nullable(),
  /** Input id → value; checked against the manifest's inputs. Long enough for a pasted DESIGN.md. */
  inputs: z.record(z.string(), z.union([z.string().max(CREATION_INPUT_MAX), z.boolean()])),
  /** 「先出 2–3 个视觉方向」: the agent asks the group to pick one before the full draft. */
  directions: z.boolean().default(false),
  botId: z.string(),
  attachmentIds: z.array(z.string()).max(10).default([]),
  /** The 创作确认卡 (creation-draft card message id) this request starts. */
  fromDraft: z.string().optional(),
})
export type CreationReq = z.infer<typeof CreationReq>

/** The creation request card (message `card`); the message body is a plain summary for old clients and Feishu. */
export const CreationCard = z.object({
  type: z.literal('creation'),
  pluginId: z.string(),
  pluginTitle: z.string(),
  category: PluginCategory,
  pluginVersion: z.string(),
  template: z.object({ id: z.string(), title: z.string() }).nullable(),
  designSystem: z.object({ id: z.string(), title: z.string(), swatches: z.array(z.string()) }).nullable(),
  inputs: z.array(z.object({ label: z.string(), value: z.string() })),
  directions: z.boolean(),
  botId: z.string(),
  botName: z.string(),
})
export type CreationCard = z.infer<typeof CreationCard>
/** A bot's proposal from the chat (creation_propose): a member starts it as is, edits it in the panel or drops it. */
export const CreationDraftCard = CreationCard.extend({
  type: z.literal('creation-draft'),
  /** Labels of required inputs the bot left blank: filled in the panel before starting. */
  missing: z.array(z.string()),
  note: z.string().nullable(),
  status: z.enum(['pending', 'started', 'dismissed']),
  /** Who started or dropped it. */
  by: z.string().nullable(),
  /** The creation request message it started. */
  creationId: z.string().nullable(),
})
export type CreationDraftCard = z.infer<typeof CreationDraftCard>
/** Generic message card; new kinds join the union and old clients fall back to the body. */
export const MessageCard = z.discriminatedUnion('type', [CreationCard, CreationDraftCard, ArtifactCard])
export type MessageCard = z.infer<typeof MessageCard>
