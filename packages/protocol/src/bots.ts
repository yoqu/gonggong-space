import { z } from 'zod'
import { ListingType } from './market.js'
import { PluginBlocker, PluginCapability, PluginScene } from './plugins.js'

// ── Bot Assembled Capabilities (GET /api/bots/:id/capabilities?groupId=) ────

/** Direct user action for a plugin that is not yet ready on a bot. */
export const BotCapabilityActionKind = z.enum([
  'fill-secret',
  'connect-account',
  'trust-machine',
  'upgrade-daemon',
  'none',
])
export type BotCapabilityActionKind = z.infer<typeof BotCapabilityActionKind>

/** Where the assembled plugin comes from. */
export const BotCapabilitySource = z.enum(['official', 'team', 'group', 'repo', 'personal'])
export type BotCapabilitySource = z.infer<typeof BotCapabilitySource>

export const BotCapabilityGroupRef = z.object({
  id: z.string(),
  name: z.string(),
})
export type BotCapabilityGroupRef = z.infer<typeof BotCapabilityGroupRef>

export const BotCapabilityItemDto = z.object({
  pluginId: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  type: ListingType,
  icon: z.string().nullable(),
  versionId: z.string(),
  scene: PluginScene,
  capabilities: z.array(PluginCapability),
  source: BotCapabilitySource,
  /** Plain-language Chinese source subtitle (e.g. '官方创作插件', '使用张磊的飞书账号'). */
  sourceLabel: z.string(),
  /** Plain-language Chinese status badge for ready items (e.g. '已连接', '开箱即用', '已就绪'). */
  statusLabel: z.string(),
  createsArtifacts: z.boolean(),
  /** First chat slash command name if any (without leading `/`). */
  chatCommand: z.string().nullable(),
  groups: z.array(BotCapabilityGroupRef),
  /** Primary group id for actions (filling secrets / opening group chat). */
  groupId: z.string().nullable(),
  /** Underlying blocker code for unavailable items (`connector` for unconnected CLI connector). */
  blocker: z.union([PluginBlocker, z.literal('connector')]).nullable(),
  /** Short plain-language Chinese badge label for unavailable items. */
  reasonLabel: z.string().nullable(),
  /** Plain-language Chinese explanation for unavailable items. */
  reason: z.string().nullable(),
  action: BotCapabilityActionKind,
  missingSecrets: z.array(z.string()).default([]),
  ownMachine: z.boolean(),
  machineId: z.string().nullable(),
  machineName: z.string().nullable(),
  machineOwnerName: z.string().nullable(),
  minDaemon: z.string().nullable(),
  daemonVersion: z.string().nullable(),
})
export type BotCapabilityItemDto = z.infer<typeof BotCapabilityItemDto>

/** GET /api/bots/:id/capabilities?groupId= — assembled plugins split into ready vs unavailable. */
export const BotCapabilitiesDto = z.object({
  botId: z.string(),
  groupId: z.string().nullable(),
  /** Non-archived groups this bot is in that the caller belongs to (for scope switching). */
  groups: z.array(BotCapabilityGroupRef),
  pluginsEnabled: z.boolean(),
  ready: z.array(BotCapabilityItemDto),
  unavailable: z.array(BotCapabilityItemDto),
})
export type BotCapabilitiesDto = z.infer<typeof BotCapabilitiesDto>
