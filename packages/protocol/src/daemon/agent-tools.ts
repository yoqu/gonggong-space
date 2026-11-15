import { z } from 'zod'
import { AgentSettings, CliSettingsSnapshot } from '../agent-settings.js'
import { AgentKind } from '../common.js'
import { AgentCatalog } from './machine.js'
import { RepoAccessReason } from './run-payloads.js'

// ── Agent tools and providers (docs/archive/2026-11/Agent工具与供应商统一管理-设计.md) ─────
/**
 * `tools`: tools.cmd; `providers`: providers.cmd; `ccSwitch`: ccswitch.* (only when the machine has CC Switch).
 * Provider settings live on the machine only: the server relays them in memory and never stores or logs them.
 */
/** `sync`: takes part in force sync; a replica on a daemon without it sits out (runs go unsynced). */
export const DaemonFeature = z.enum([
  'tools',
  'providers',
  'ccSwitch',
  'sync',
  'sessionFork',
  'agentSettings',
  'reprobe',
  'plugins',
  'gitOps',
  /** git.diff, git.refresh and commit `paths`: a daemon without it would commit everything. */
  'gitOps2',
  /** `repo` of git.refs / git.action: a daemon without it would act on the root repo instead. */
  'gitRepos',
  /**
   * The IDEA-style git tools: git.changes / show / blame / stashes / conflict, `repo` on every git read, log filters,
   * diff options, tags and recent branches in git.refs, the new git.action kinds and their `args`.
   */
  'gitOps3',
  /**
   * The second IDEA pass (docs/archive/2026-11/Git管理-IDEA对标-五轮迭代.md): push `target` with explicit refs, stash `expect`,
   * discard `keepAdded` / `patch`, the add / ignore actions, git.diff `oldPath` / `whitespace`, git.action.result
   * `detail`, checkout `localCommits`, pull `from`, branch-create `force`, push `commit`, reset / amend `expect`,
   * rebase `todo`, resolve `paths`, the apply / restore actions.
   */
  'gitOps4',
  'terminal-v2',
  /** A terminal open's `cwd`: machine terminals in a directory of their own. */
  'terminal-dir',
  /** 我的机器管理 on the web: logs.get, workspaces.list and workspace.delete. */
  'machineAdmin',
  /** 空间: workspace.gc, lastUsedAt / changes / disk in workspaces.result, and deletes that skip busy dirs. */
  'storageAdmin',
  /** Hosted artifacts: RunStart.artifacts / artifactExclude and the artifact version routes. */
  'artifacts',
  /** artifact.snapshot: screenshots of versions the daemon did not make. */
  'artifactSnapshot',
  /** `args` of the official login (Claude Code command-line arguments): a daemon without it would drop them. */
  'claudeArgs',
  /** A provider's `configDir` / `executablePath` (a local Claude profile): a daemon without it would demand a key. */
  'claudeProfile',
  /** A provider's `args` (Claude Code command-line arguments): a daemon without it would drop them. */
  'providerArgs',
  /** gitaccess.cmd: ssh keys, HTTPS tokens, access tests and host keys from the web. */
  'gitAccess',
  /** diag.run: `gg doctor` from the web. */
  'diag',
  /** Not a capability: the daemon runs in a container (GONGGONG_CONTAINER=1); upgrades come from a new image. */
  'container',
  /** Not a capability: the daemon never upgrades itself (GONGGONG_NO_AUTO_UPGRADE or settings). */
  'noAutoUpgrade',
  /** upgrade.start: a Linux CLI daemon that upgrades itself, started from the web. */
  'upgrade',
  /** Runs Gemini CLI bots: a daemon without it cannot read a run.start for one. */
  'gemini',
  /** Runs CodeBuddy (WorkBuddy) bots: a daemon without it cannot read a run.start for one. */
  'codebuddy',
  /** 帮我审批's rules (开发常用命令, workspace edits, AI pre-review that only stops risks): older daemons ask more. */
  'approvalGates',
  /** 帮我审批 hands approvals to the agent's own reviewer (Claude auto, Codex agent on an official login) where it works. */
  'builtinReview',
  /** Runs pi bots: a daemon without it cannot read a run.start for one. */
  'pi',
  /** Runs DeepSeek Harness bots: a daemon without it cannot read a run.start for one. */
  'deepseek',
  /** Runs Antigravity CLI bots: a daemon without it cannot read a run.start for one. */
  'antigravity',
  /** PluginRef.mcp (plan 插件扩展点 S1): `{node}` / `{pkg}` filled in and the servers handed to the agent. */
  'pluginMcp',
  /** presets.sync, artifact `plugin` and manifest `artifact.kit` (plan 插件扩展点 S2). */
  'presetSync',
])
export type DaemonFeature = z.infer<typeof DaemonFeature>

export const ToolKind = z.enum([
  'node',
  'claude',
  'codex',
  'gemini',
  'codebuddy',
  'pi',
  'deepseek',
  'antigravity',
])
export type ToolKind = z.infer<typeof ToolKind>
export const ToolStatus = z.object({
  kind: ToolKind,
  installed: z.boolean(),
  version: z.string().nullable(),
  /** Latest version on the mirror; null when it could not be checked. */
  latest: z.string().nullable(),
  /** Installed by Gonggong (and so upgradable by it). */
  managed: z.boolean(),
  path: z.string().nullable(),
  /** How the user's own install is upgraded (Gonggong runs it on 升级); null when managed or unknown, absent from older daemons. */
  upgradeCommand: z.string().nullable().optional(),
  /** Not on npm, so Gonggong neither installs nor upgrades it: the maker's install command, run on the machine. */
  installCommand: z.string().nullable().optional(),
})
export type ToolStatus = z.infer<typeof ToolStatus>
/** Where Node and the agent CLIs are downloaded from; npmmirror by default. */
export const Mirror = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('npmmirror') }),
  z.object({ kind: z.literal('official') }),
  z.object({
    kind: z.literal('custom'),
    registry: z.url({ protocol: /^https?$/ }),
    node: z.url({ protocol: /^https?$/ }),
  }),
])
export type Mirror = z.infer<typeof Mirror>
export const ToolsSettings = z.object({ mirror: Mirror })
export type ToolsSettings = z.infer<typeof ToolsSettings>
/** `latest` or an exact x.y.z (optionally v-prefixed); anything else never reaches npm. */
export const TOOL_VERSION = /^(latest|v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/

export const ModelMap = z.object({
  haiku: z.string().optional(),
  sonnet: z.string().optional(),
  opus: z.string().optional(),
})
export type ModelMap = z.infer<typeof ModelMap>
export const PresetGroup = z.enum(['cn', 'aggregator', 'global'])
/** A built-in vendor (adapted from CC Switch): choosing one only leaves the API key to fill in. */
export const ProviderPreset = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  agent: AgentKind,
  name: z.string().min(1).max(60),
  group: PresetGroup.default('global'),
  websiteUrl: z.string().nullable().default(null),
  apiKeyUrl: z.string().nullable().default(null),
  baseUrl: z.string(),
  apiKeyField: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  models: ModelMap.nullable().default(null),
  modelOptions: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  wireApi: z.string().nullable().default(null),
  effort: z.string().nullable().default(null),
  /** Claude: context window per model id, filled into CLAUDE_CODE_MAX_CONTEXT_TOKENS unless the provider sets it. */
  modelContext: z.record(z.string(), z.number().int()).default({}),
})
export type ProviderPreset = z.infer<typeof ProviderPreset>
/** A machine's provider as it may leave the machine: `apiKey` masked to its last 4 characters at most. */
export const ProviderView = z.object({
  id: z.string(),
  agent: AgentKind,
  name: z.string(),
  presetId: z.string().nullable(),
  revision: z.number().int(),
  configDir: z.string().nullable().optional(),
  executablePath: z.string().nullable().optional(),
  baseUrl: z.string(),
  apiKey: z.string(),
  apiKeyField: z.string().nullable(),
  model: z.string().nullable(),
  models: ModelMap.nullable(),
  /** Values of `isSecretEnv` variables masked like the API key. */
  env: z.record(z.string(), z.string()),
  /** Password masked; null = direct. */
  proxy: z.string().nullable(),
  /** Claude Code command-line arguments, one per line. */
  args: z.array(z.string()).default([]),
  wireApi: z.string().nullable(),
  effort: z.string().nullable(),
  source: z.object({ kind: z.enum(['cc-switch', 'link']), id: z.string().optional() }).nullable(),
})
export type ProviderView = z.infer<typeof ProviderView>
/** `official` = the CLI's own login (nothing injected); a bot without an override inherits the machine default. */
export const OFFICIAL_PROVIDER = 'official'
export const INHERIT_PROVIDER = 'inherit'
/** What an official login runs with besides the CLI's own config; proxy password masked, null = direct. */
export const OfficialSettings = z.object({
  env: z.record(z.string(), z.string()),
  proxy: z.string().nullable(),
  /** Extra Claude Code command-line arguments, one per line (`--flag value`, `--flag=value` or `--flag`). */
  args: z.array(z.string()).default([]),
})
export type OfficialSettings = z.infer<typeof OfficialSettings>
export const ProviderStoreView = z.object({
  /** Default per agent: a provider id or `official`; absent = official. */
  machine: z.partialRecord(AgentKind, z.string()),
  /** Official login extras per agent; absent = none. */
  official: z.partialRecord(AgentKind, OfficialSettings).default({}),
  /** Bot overrides: bot id → provider id or `official`; absent = inherit. */
  bots: z.record(z.string(), z.string()),
  providers: z.array(ProviderView),
  /** Machine defaults per agent kind; absent = Claude Code's defaults, CLI config inherited. */
  agentSettings: z.partialRecord(AgentKind, AgentSettings).default({}),
  /** The CLI's own user-level config per agent kind; absent = none found / not read. */
  cli: z.partialRecord(AgentKind, CliSettingsSnapshot).default({}),
  /** Latest session of each (group, bot) and the provider it is pinned to, for the switch confirmation. */
  sessions: z.array(
    z.object({ groupId: z.string(), botId: z.string(), agent: AgentKind, provider: z.string() }),
  ),
})
export type ProviderStoreView = z.infer<typeof ProviderStoreView>
/**
 * Adds a provider (no `id`: from `presetId` or by hand) or edits one. Absent fields keep what is there (or the
 * preset's value); `apiKey` is required for a new one and replaced only when given.
 */
export const ProviderInput = z.object({
  id: z.string().optional(),
  agent: AgentKind,
  presetId: z.string().optional(),
  name: z.string().trim().min(1).max(64).optional(),
  configDir: z.string().trim().min(1).max(4096).optional(),
  executablePath: z.string().trim().max(4096).optional(),
  baseUrl: z.url({ protocol: /^https?$/ }).optional(),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  apiKeyField: z.enum(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']).optional(),
  model: z.string().trim().max(128).optional(),
  models: ModelMap.optional(),
  env: z.record(z.string(), z.string()).optional(),
  /** '' = direct; the masked one from the view = unchanged. */
  proxy: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).optional(),
  /** Claude only; absent = unchanged. The daemon refuses flags 共工 manages itself. */
  args: z.array(z.string()).optional(),
  effort: z.string().max(32).optional(),
})
export type ProviderInput = z.infer<typeof ProviderInput>
/** Sets an official login's extras; absent fields keep what is there. */
export const OfficialInput = z.object({
  env: ProviderInput.shape.env,
  proxy: ProviderInput.shape.proxy,
  /** Claude only; absent = unchanged. The daemon refuses flags 共工 manages itself. */
  args: z.array(z.string()).optional(),
})
export type OfficialInput = z.infer<typeof OfficialInput>
/** CC Switch import preview row: `key` is what ccswitch.apply takes; `existing` = the local provider it updates. */
export const CcSwitchCandidate = z.object({
  key: z.string(),
  agent: AgentKind,
  name: z.string(),
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string().nullable(),
  current: z.boolean(),
  existing: z.string().nullable(),
})
export type CcSwitchCandidate = z.infer<typeof CcSwitchCandidate>
/** A (group, bot) whose session keeps a provider other than a new session would use (names only). */
export const ProviderStateItem = z.object({
  groupId: z.string(),
  botId: z.string(),
  session: z.string(),
  effective: z.string(),
})
export type ProviderStateItem = z.infer<typeof ProviderStateItem>

/** Streamed output of a running tools.cmd install / upgrade (lines capped by the daemon). */
export const ToolsProgress = z.object({
  t: z.literal('tools.progress'),
  requestId: z.string(),
  line: z.string(),
})
export const ToolsResult = z.object({
  t: z.literal('tools.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  tools: z.array(ToolStatus),
  settings: ToolsSettings,
})
export type ToolsResult = z.infer<typeof ToolsResult>
export const ProvidersResult = z.object({
  t: z.literal('providers.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  view: ProviderStoreView.optional(),
  presets: z.array(ProviderPreset).optional(),
  catalog: AgentCatalog.optional(),
  /** The provider saved or imported. */
  id: z.string().optional(),
})
export type ProvidersResult = z.infer<typeof ProvidersResult>
export const CcSwitchResult = z.object({
  t: z.literal('ccswitch.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  candidates: z.array(CcSwitchCandidate),
  /** Local ids written by ccswitch.apply. */
  imported: z.array(z.string()),
  view: ProviderStoreView.optional(),
})
export type CcSwitchResult = z.infer<typeof CcSwitchResult>
/** agents.reprobe done; on success the new catalog has been sent in an agents.update first. */
export const AgentsReprobeResult = z.object({
  t: z.literal('agents.reprobe.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
})
/** A public key in the machine's `~/.ssh` (the private key never leaves the machine). */
export const SshKeyView = z.object({
  path: z.string(),
  type: z.string(),
  fingerprint: z.string(),
  publicKey: z.string(),
  comment: z.string().nullable(),
})
export type SshKeyView = z.infer<typeof SshKeyView>
/** An HTTPS token 共工 stored for `host`; only its first characters are shown. */
export const GitTokenView = z.object({ host: z.string(), username: z.string(), masked: z.string() })
export type GitTokenView = z.infer<typeof GitTokenView>
export const GitAccessView = z.object({
  sshKeys: z.array(SshKeyView),
  tokens: z.array(GitTokenView),
  /** The machine's own global `credential.helper` (osxkeychain, manager…); null = none. */
  helper: z.string().nullable(),
  /** Hosts in `~/.ssh/known_hosts` (hashed entries are left out). */
  knownHosts: z.array(z.string()),
})
export type GitAccessView = z.infer<typeof GitAccessView>
/** `git ls-remote` of one URL with the machine's credentials. */
export const GitAccessTest = z.object({
  url: z.string(),
  ok: z.boolean(),
  reason: RepoAccessReason.nullable(),
  detail: z.string().nullable(),
  /** The ssh host whose key is not trusted yet, with the key fingerprints trustHost would add. */
  hostKey: z.object({ host: z.string(), fingerprints: z.array(z.string()) }).nullable(),
})
export type GitAccessTest = z.infer<typeof GitAccessTest>
export const GitAccessResult = z.object({
  t: z.literal('gitaccess.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  view: GitAccessView.nullable(),
  test: GitAccessTest.nullable(),
})
export type GitAccessResult = z.infer<typeof GitAccessResult>
export const DiagCheckKind = z.enum([
  'server',
  'agent',
  'git',
  'disk',
  'eol',
  'screen_recording',
  'accessibility',
])
export type DiagCheckKind = z.infer<typeof DiagCheckKind>
/** One `gg doctor` check; `detail` is in the daemon's language. */
export const DiagCheck = z.object({
  kind: DiagCheckKind,
  status: z.enum(['ok', 'warn', 'error', 'skipped']),
  detail: z.string(),
})
export type DiagCheck = z.infer<typeof DiagCheck>
export const DiagResult = z.object({
  t: z.literal('diag.result'),
  requestId: z.string(),
  checks: z.array(DiagCheck),
})
export type DiagResult = z.infer<typeof DiagResult>
/**
 * Answer to upgrade.start: `downloading` (restarts once downloaded and idle), `ready` (downloaded, restarts once
 * idle), `current` (not newer than this build), `refused` (failed verification before).
 */
export const UpgradeState = z.enum(['downloading', 'ready', 'current', 'refused'])
export type UpgradeState = z.infer<typeof UpgradeState>
export const UpgradeResult = z.object({
  t: z.literal('upgrade.result'),
  requestId: z.string(),
  state: UpgradeState,
})
/** Replaces the machine's list; sent after welcome, after each run and whenever providers change. */
export const BotsProviderState = z.object({
  t: z.literal('bots.providerState'),
  items: z.array(ProviderStateItem),
})
