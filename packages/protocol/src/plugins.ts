import { z } from 'zod'
import { ArtifactExportFormat, ArtifactKind, ArtifactStore } from './artifact-kind.js'
import { ArtifactCard } from './artifacts.js'
import { AgentKind } from './common.js'
import { ConnectorDriver } from './daemon/connectors.js'
import { ApiProtocol, LegacyProviderPreset, ProviderPreset, SkillFile } from './daemon.js'
import { type SecretRequirement, SecretRequirements } from './secrets.js'

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

export const PluginCategory = z.enum([
  'web',
  'deck',
  'poster',
  'dashboard',
  'video',
  'other',
  'tool',
  'agent',
  'provider',
  'connector',
])
export type PluginCategory = z.infer<typeof PluginCategory>
/** The market's four shelves, by what a plugin is for. */
export const PluginShelf = z.enum(['creation', 'tool', 'agent', 'provider', 'connector'])
export type PluginShelf = z.infer<typeof PluginShelf>
export const shelfOf = (c: PluginCategory): PluginShelf =>
  c === 'tool' || c === 'agent' || c === 'provider' || c === 'connector' ? c : 'creation'

/**
 * A connector (plan 连接器-方案): an outside system a person connects once (its required secrets) and then just
 * asks for. Personal when a required secret is personal or overridable, else shared (a team admin connects it).
 */
export const PluginConnector = z.object({
  /** 「试试这样用」: prompts filled into the chat box. */
  examples: z.array(z.string().min(1).max(200)).max(6).default([]),
  /** 「如何获取」: where to get the key. */
  docs: z.string().url().optional(),
  /**
   * Connected by the person's own CLI login on the bot's machine (e.g. lark-cli, meegle), not a key kept here: 连接
   * fills this request into the chat box for the bot to walk them through the login; 共工 cannot tell whether they did.
   */
  login: z.string().min(1).max(200).optional(),
  /**
   * Detected, installed and logged in by daemons with `connectors` (plan 连接器-体验升级方案): `driver` picks the
   * built-in commands, `npm` the package installed when missing, `urlHosts` links that mean the connector is needed.
   * Older daemons fall back to `login`.
   */
  cli: z
    .object({
      driver: ConnectorDriver,
      npm: z.string().min(1).max(100),
      urlHosts: z.array(z.string().min(1).max(100)).max(10).default([]),
    })
    .optional(),
  /**
   * How the server checks a key-based connection (连通性): a request whose headers / body may reference the
   * connector's secrets as `${secret:NAME}`; 2xx is connected, 401 / 403 an expired or wrong key, anything else unknown.
   */
  check: z
    .object({
      url: z.string().url().startsWith('https://'),
      method: z.enum(['GET', 'POST']).default('GET'),
      headers: z.record(z.string(), z.string()).default({}),
      body: z.string().max(2000).optional(),
    })
    .optional(),
})
export type PluginConnector = z.infer<typeof PluginConnector>
/** Creates artifacts with its entry skill; a connector's entry skill is how to use the system it connects instead. */
export const createsArtifacts = (m: { entry: string | null; category: PluginCategory }) =>
  !!m.entry && m.category !== 'connector'
export const shelfCategories = (s: PluginShelf) => PluginCategory.options.filter((c) => shelfOf(c) === s)

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
  /** An animated image (e.g. the first slides cycling) played in place of the preview while the card is hovered. */
  demo: PkgPath.nullable().default(null),
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

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const EnvName = z.string().regex(ENV_NAME)
/** A path on the machine: `~` is the user's home, `{home}` the agent's own config directory (`home` below). */
const MachinePath = z.string().min(1).max(300)
const Semver = z.string().regex(SEMVER)
const Label = z.string().min(1).max(40)

/** One way to tell the agent is logged in (§5.1 `login.check`); the first that holds gives the label. */
export const AgentLoginCheck = z.discriminatedUnion('type', [
  /** One of these env vars is set and not empty. */
  z.object({ type: z.literal('env'), names: z.array(EnvName).min(1), label: Label }),
  /** A `KEY=value` line (`export` allowed) with a non-empty value for one of `keys`, in any of `files`. */
  z.object({
    type: z.literal('envFile'),
    files: z.array(MachinePath).min(1),
    keys: z.array(EnvName).min(1),
    label: Label,
  }),
  /** A `KEY: value` line with a non-empty value. */
  z.object({ type: z.literal('yamlKey'), file: MachinePath, key: EnvName, label: Label }),
  /**
   * The JSON file (comments allowed) has `equals` at the JSON pointer. `loggedOut`: it holds for a login that does not
   * work (「未登录 · label」), e.g. a sign-in the agent dropped.
   */
  z.object({
    type: z.literal('jsonValue'),
    file: MachinePath,
    pointer: z.string().startsWith('/'),
    equals: z.string(),
    label: Label,
    loggedOut: z.boolean().default(false),
  }),
  /** The JSON object's keys are the logins, listed as the label. */
  z.object({ type: z.literal('jsonKeys'), file: MachinePath }),
])
export type AgentLoginCheck = z.infer<typeof AgentLoginCheck>

/** What a permission tier sets: an ACP session mode, or process env (needs a restart to change). */
const AgentTier = z.object({
  mode: z.string().min(1).optional(),
  env: z.record(EnvName, z.string()).default({}),
})
/**
 * Arguments and env values may hold `{prompt}` (the bot's system prompt), `{state}` (the (group, bot) state folder),
 * `{pkg}` (the plugin folder), `{node}`, `{cli}` and, in `skills.args`, `{pluginDirs}` (one argument per folder).
 */
const Template = z.string().max(500)
const ProviderEnvNames = z.object({ apiKey: EnvName, baseUrl: EnvName.nullable(), model: EnvName.nullable() })

/**
 * An agent adapter (plan 插件扩展点 §5): how the daemon installs, starts and drives an ACP agent. Every field picks
 * from a closed set of strategies; what they cannot say goes into `launchScript`, a Node script of the plugin run
 * before each agent process starts (stdin: the run, stdout: `{ env, args }`).
 */
export const PluginAgent = z.object({
  id: z.string().regex(ID),
  title: z.string().min(1).max(40),
  vendor: z.string().min(1).max(40),
  install: z
    .object({
      /** null: not on npm, so 共工 cannot install it; the owner runs `command` on the machine. */
      npm: z.string().min(1).max(100).nullable(),
      /** The maker's own install command, shown when the CLI is missing. */
      command: z.string().min(1).max(200).nullable().default(null),
      bin: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,39}$/),
      /** The CLI's script inside its npm package, run on the daemon's Node; null: a native binary. */
      script: z.string().max(200).nullable().default(null),
      brew: z.string().max(60).nullable().default(null),
      minVersion: Semver,
      minNode: Semver.default('22.0.0'),
    })
    .refine((i) => i.npm || i.command, '需要 npm 或 command'),
  acp: z.discriminatedUnion('kind', [
    /** The CLI speaks ACP itself with these arguments. */
    z.object({ kind: z.literal('native'), args: z.array(Template).max(10).default([]) }),
    /** A pinned adapter npm package does (its `entry` run on the daemon's Node). */
    z.object({
      kind: z.literal('adapter'),
      npm: z.string().min(1).max(100),
      version: Semver,
      entry: z.string().max(200).default('dist/index.js'),
    }),
  ]),
  /** The CLI runs shell commands in its process directory, not the session's: start it in the workspace. */
  chdir: z.boolean().default(false),
  systemPrompt: z.discriminatedUnion('via', [
    z.object({ via: z.literal('arg'), args: z.array(Template).min(1).max(5) }),
    z.object({ via: z.literal('env'), env: EnvName }),
    /** `launchScript` writes it where the agent reads it. */
    z.object({ via: z.literal('script') }),
    /** session/new `_meta.<key>.systemPrompt.append`. */
    z.object({ via: z.literal('meta'), key: z.string().min(1).max(40) }),
  ]),
  mcp: z
    .object({
      /** `acp`: session/new `mcpServers`; `env`: a JSON map name → config in `env`, each with `extra` merged in. */
      via: z.enum(['acp', 'env']).default('acp'),
      env: EnvName.optional(),
      extra: z.record(z.string(), z.unknown()).default({}),
      /** The built-in gonggong server: `script` hands it to `launchScript` (e.g. to give it a timeout) instead. */
      gonggong: z.enum(['acp', 'script']).default('acp'),
    })
    .refine((m) => m.via !== 'env' || m.env, '需要 env')
    .default({ via: 'acp', extra: {}, gonggong: 'acp' }),
  skills: z.object({
    /** `link`: team and plugin skills linked into `<cwd>/.agents/skills`; `arg`: their folders in `args`. */
    via: z.enum(['link', 'arg']),
    args: z.array(Template).max(5).default([]),
    /** The repo's own skill folders, which win over a team skill of the same name. */
    dirs: z.array(z.string().max(60)).min(1).max(5),
  }),
  /** Per tier; null: the agent has no permission modes and the owner's rules answer its requests. */
  tiers: z
    .object({
      full: AgentTier,
      workspace: AgentTier,
      readonly: AgentTier,
      /** Tier env is read at start: a tier change needs a new process. */
      restartOnChange: z.boolean().default(false),
    })
    .nullable(),
  /** Env the run's provider goes into; null: the agent keeps its own logins. */
  provider: z
    .object({
      /** The provider endpoints it can run on. */
      protocols: z.array(ApiProtocol).min(1),
      env: ProviderEnvNames,
      /** The agent maker's own services: no base URL is set for them. */
      skipBaseUrls: z.array(z.string().url()).max(10).default([]),
      /** Per endpoint protocol: env names in place of `env`, and the env and arguments that make the CLI speak it. */
      byProtocol: z
        .partialRecord(
          ApiProtocol,
          z.object({
            env: ProviderEnvNames.optional(),
            set: z.record(EnvName, z.string().max(200)).default({}),
            args: z.array(Template).max(5).default([]),
          }),
        )
        .default({}),
      /** The CLI ignores a provider without a model: the run fails, saying so, instead of falling back to its login. */
      needsModel: z.boolean().default(false),
    })
    .nullable(),
  /** The agent's config directory (`env`, else `default` under the user's home) and its models file in it. */
  home: z.object({
    env: EnvName.nullable(),
    default: z.string().min(1).max(100),
    config: z.string().min(1).max(100),
  }),
  login: z.object({
    checks: z.array(AgentLoginCheck).max(6),
    /** Say 「未登录」 when no check holds; false: it cannot tell (a key may come from elsewhere). */
    loggedOut: z.boolean().default(true),
    /** What the owner runs on the machine to log in, and what to do in it. */
    command: z.string().min(1).max(100),
    hint: z.string().min(1).max(200),
  }),
  env: z.record(EnvName, Template).default({}),
  permission: z
    .object({
      /** `_meta` key of permission requests naming the MCP server and tool (`{ mcp: { server_name, tool_name } }`). */
      mcpMeta: z.string().max(60).nullable().default(null),
    })
    .default({ mcpMeta: null }),
  /** `_meta` key of a failed prompt carrying the JSON-RPC error. */
  errors: z.object({ metaKey: z.string().max(60).nullable().default(null) }).default({ metaKey: null }),
  /** Folders in a repo that steer the agent: writing there always asks the owner. */
  steeringDirs: z.array(z.string().max(60)).max(5).default([]),
  /** Folder under the daemon home for per-(group, bot) state (`{state}`, swept with the pair; `probe` for probes). */
  state: z.string().regex(ID).nullable().default(null),
  launchScript: PkgPath.nullable().default(null),
})
export type PluginAgent = z.infer<typeof PluginAgent>

/** Extension points (plan 插件扩展点); each optional. */
export const PluginContributes = z.object({
  mcp: z.array(PluginMcp).max(10).default([]),
  commands: z.array(PluginCommand).max(30).default([]),
  /**
   * Provider presets (§6): platform-layer plugins only; added to every daemon's built-in ones, same id replacing.
   * Manifests written before vendors had endpoints list one per agent (normalizePresets merges them).
   */
  providers: z
    .array(z.union([ProviderPreset, LegacyProviderPreset]))
    .max(300)
    .default([]),
  /** Agent adapters (§5): they run code on the machine, so they need `exec`. */
  agents: z.array(PluginAgent).max(5).default([]),
})
export type PluginContributes = z.infer<typeof PluginContributes>

/** The permissions what a manifest contributes needs; it must declare exactly these. */
export const requiredPermissions = (c: PluginContributes): PluginPermission[] =>
  PluginPermission.options.filter(
    (p) =>
      c.mcp.some((m) => m.transport === (p === 'exec' ? 'stdio' : 'http')) ||
      (p === 'exec' && c.agents.length > 0),
  )

/** Runs code on the executing machine (§9): needs 插件代码 on, the machine owner's consent and a pinned install. */
export const pluginRunsCode = (m: { permissions: PluginPermission[] }) => m.permissions.includes('exec')
/** Groups use a plugin only for its entry skill, MCP or commands; one bringing just agents or provider presets applies to machines. */
export const pluginInGroups = (m: {
  entry: string | null
  contributes: { mcp: unknown[]; commands: unknown[] }
}) => !!m.entry || m.contributes.mcp.length > 0 || m.contributes.commands.length > 0

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
    contributes: PluginContributes.default({ mcp: [], commands: [], providers: [], agents: [] }),
    /** The plugin's tile: an svg or png in the folder; absent: its category's glyph. */
    icon: PkgPath.optional(),
    templates: z.array(PluginTemplate).max(80).default([]),
    designSystems: z.array(PluginDesignSystem).max(80).default([]),
    inputs: z.array(PluginInput).max(12).default([]),
    /**
     * Secrets it needs (plan 团队密钥-方案, Skill密钥声明): names or SecretRequirements on upload; parsed, the names of
     * the required ones (runs without them do not get the plugin), so readers of old snapshots see the same shape.
     */
    secrets: SecretRequirements.default([]),
    /** Every declared secret; absent in snapshots stored before declarations (read them with `secretSpecsOf`). */
    secretSpecs: SecretRequirements.optional(),
    /** Present exactly when the category is `connector` (absent in older snapshots). */
    connector: PluginConnector.optional(),
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
        /** The kind of artifact it creates (absent: prototype). */
        kind: ArtifactKind.optional(),
        /** The folder of its built editor, served by the preview origin under `/__oa/<plugin>@<version>/`. */
        editor: PkgPath.optional(),
        exports: z.array(ArtifactExportFormat).max(10).optional(),
        store: ArtifactStore.optional(),
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
    if ((m.category === 'connector') !== !!m.connector)
      ctx.addIssue({ code: 'custom', path: ['connector'], message: '连接器类插件必须且只能由它填写' })
    if (m.connector?.login && (m.secretSpecs ?? m.secrets).some((s) => s.required))
      ctx.addIssue({
        code: 'custom',
        path: ['connector', 'login'],
        message: 'CLI 登录的连接器不能再要求密钥',
      })
    const need = requiredPermissions(m.contributes)
    if (need.join() !== [...new Set(m.permissions)].sort().join())
      ctx.addIssue({ code: 'custom', path: ['permissions'], message: `必须正好是 [${need.join(', ')}]` })
    const specs = m.secretSpecs ?? m.secrets
    const names = m.contributes.mcp.map((c) => c.name)
    for (const [k, c] of m.contributes.mcp.entries()) {
      if (names.indexOf(c.name) !== k)
        ctx.addIssue({ code: 'custom', path: ['contributes', 'mcp', k, 'name'], message: `重名 ${c.name}` })
      const values = Object.values(c.transport === 'stdio' ? c.env : c.headers)
      for (const v of values)
        for (const [, name] of v.matchAll(PLUGIN_SECRET_REF))
          if (!specs.some((s) => s.name === name && s.required))
            ctx.addIssue({
              code: 'custom',
              path: ['contributes', 'mcp', k],
              message: `${name} 不在 secrets 的必需项里`,
            })
    }
  })
  // Typed optional: stored snapshots from before declarations lack it (read them with `secretSpecsOf`).
  .transform((m): Omit<typeof m, keyof ParsedSecrets> & ParsedSecrets => {
    const specs = m.secretSpecs ?? m.secrets
    return { ...m, secrets: specs.filter((s) => s.required).map((s) => s.name), secretSpecs: specs }
  })
type ParsedSecrets = { secrets: string[]; secretSpecs?: SecretRequirement[] }
export type PluginManifest = z.infer<typeof PluginManifest>

/** A stored manifest's declared secrets: old snapshots only have the names, each a required shared secret. */
export const secretSpecsOf = (m: {
  secrets?: string[]
  secretSpecs?: SecretRequirement[]
}): SecretRequirement[] =>
  m.secretSpecs ??
  (m.secrets ?? []).map((name) => ({ name, description: '', mode: 'shared', required: true }))

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
