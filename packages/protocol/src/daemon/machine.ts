import { z } from 'zod'
import { AgentKind } from '../common.js'

/** Bumped on any breaking change of the daemon <-> server wire format. */
export const PROTOCOL_VERSION = 1

export const ConfigChoice = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().optional(),
})
export type ConfigChoice = z.infer<typeof ConfigChoice>
/** Thought levels depend on the model (both adapters), so each model carries its own and the one it starts with. */
export const ModelChoice = ConfigChoice.extend({
  efforts: z.array(ConfigChoice),
  effort: z.string().nullable(),
})
export type ModelChoice = z.infer<typeof ModelChoice>
/**
 * Adapter "default" rows are left out: a null model / effort already means the adapter's default. `current`,
 * `efforts` and `effort` describe the model a fresh session starts with (current null = the adapter's unnamed default).
 */
export const AgentCatalog = z.object({
  models: z.array(ModelChoice),
  current: z.string().nullable(),
  efforts: z.array(ConfigChoice),
  effort: z.string().nullable(),
})
export type AgentCatalog = z.infer<typeof AgentCatalog>

/** Levels and starting level of `model`; null = the model a fresh session starts with. Undefined if not offered. */
export function modelEfforts(catalog: AgentCatalog, model: string | null) {
  return model === null ? catalog : catalog.models.find((m) => m.value === model)
}

/** `effort` if `model` offers it, else the model's starting level; unchanged without a catalog to check. */
export function fitEffort(catalog: AgentCatalog | null, model: string | null, effort: string | null) {
  const m = catalog && modelEfforts(catalog, model)
  if (!m) return effort
  return effort && m.efforts.some((e) => e.value === effort) ? effort : m.effort
}

const EFFORT_NAMES: Record<string, string> = {
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
}
export const effortName = (value: string) => EFFORT_NAMES[value] ?? value
export const modelName = (catalog: AgentCatalog | null, value: string) =>
  catalog?.models.find((m) => m.value === value)?.name ?? value
/** e.g. `Opus · 高`; a null model reads as 默认模型. `tr` translates the Chinese parts; model names stay. */
export const agentConfigLabel = (
  catalog: AgentCatalog | null,
  model: string | null,
  effort: string | null,
  tr = (key: string) => key,
) =>
  [
    model === null ? tr('默认模型') : modelName(catalog, model),
    ...(effort ? [tr(effortName(effort))] : []),
  ].join(' · ')

export const AgentInfo = z.object({
  kind: AgentKind,
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
  /** Oldest CLI version the bundled ACP adapter supports; older ones still run but the bot shows a warning. */
  minVersion: z.string().nullable().default(null),
  /** What the adapter offers, probed by the daemon; null until probed or when unavailable. */
  catalog: AgentCatalog.nullable().default(null),
  /** Latest version on the machine's mirror (last check, cached by the daemon); absent from older daemons. */
  latest: z.string().nullable().optional(),
  /** Installed by Gonggong under its home, so it can upgrade it; absent from older daemons. */
  managed: z.boolean().optional(),
})
export type AgentInfo = z.infer<typeof AgentInfo>

/** Host facts shown to the owner and sysadmin; any of them may be unavailable on a given OS. */
export const SystemInfo = z.object({
  osVersion: z.string().nullable(),
  kernel: z.string().nullable(),
  cpuModel: z.string().nullable(),
  cpuCores: z.number().int().nullable(),
  memoryBytes: z.number().nullable(),
  macAddress: z.string().nullable(),
})
export type SystemInfo = z.infer<typeof SystemInfo>

export const MachineInfo = z.object({
  name: z.string().min(1),
  os: z.enum(['macos', 'linux', 'windows']),
  arch: z.string(),
  /**
   * sha256 of the OS machine id (IOPlatformUUID / machine-id / MachineGuid): logging in again from the same host
   * restores its machine instead of adding one. Null from daemons that predate it.
   */
  hardwareId: z.string().nullable().default(null),
  system: SystemInfo.nullable().default(null),
})
export type MachineInfo = z.infer<typeof MachineInfo>
