import type {
  AgentKind,
  AgentSettingsReq,
  AgentSettingValues,
  CcSwitchCandidate,
  CcSwitchImportedDto,
  MachineAgentsDto,
  OfficialProviderReq,
  ProviderPreset,
  ProviderSavedDto,
  ProviderStoreView,
  SaveProviderReq,
  ToolKind,
} from '@gonggong/protocol'
import type { ReactNode } from 'react'

export type ToolOpKind = 'install' | 'upgrade'

/** A bot that runs on the machine: 使用它的 Bot, and whose overrides Agent 设置 names. */
export interface AgentBotRef {
  id: string
  name: string
  agentKind: AgentKind
  agentSettings?: AgentSettingValues
}

/**
 * Where the Agent page reads and writes the machine's agents and providers. The web relays to the machine's daemon
 * (api + realtime, webSource.ts); the desktop app calls the gonggong crate over IPC. The components never call
 * either directly.
 */
export interface AgentsSource {
  /** Unique per machine: names radio groups and remounts state when the machine changes. */
  key: string
  /** DaemonFeature values of the machine's client: `protocolProviders`, `ccSwitch`, `claudeProfile`, `agentSettings`… */
  features: readonly string[]
  loadAgents(): Promise<MachineAgentsDto>
  /**
   * Runs one install / upgrade (one at a time per machine). `onLine` gets its output as it comes; resolves with the
   * new state (null = not known) once it succeeded, rejects with the error otherwise.
   */
  runTool(kind: ToolKind, op: ToolOpKind, onLine: (line: string) => void): Promise<MachineAgentsDto | null>
  loadProviders(): Promise<ProviderStoreView>
  /** Built-in vendors, each with its endpoints per protocol. */
  presets(): Promise<ProviderPreset[]>
  /** `id` null adds a provider. */
  saveProvider(id: string | null, body: SaveProviderReq): Promise<ProviderSavedDto>
  removeProvider(id: string): Promise<ProviderStoreView>
  /** The machine default of `agent`: a provider id or `official`, and its model (null = the endpoint's). */
  setDefault(agent: AgentKind, choice: string, model: string | null): Promise<ProviderStoreView>
  saveOfficial(body: OfficialProviderReq): Promise<ProviderStoreView>
  saveAgentSettings(body: AgentSettingsReq): Promise<ProviderStoreView>
  /** A `ccswitch://` provider link, parsed by the machine. */
  importLink(link: string): Promise<ProviderSavedDto>
  /** CC Switch on the machine; absent when it has none. */
  ccSwitch?: {
    preview(): Promise<CcSwitchCandidate[]>
    apply(keys: string[]): Promise<CcSwitchImportedDto>
  }
  /** Hidden Claude directories in the machine's home (`~/.claude-work`), offered as profiles. */
  claudeDirs?(): Promise<string[]>
  /** A directory picker on the machine; absent = the path is typed. */
  renderDirPicker?(p: {
    start: string | null
    onPick: (path: string) => void
    onClose: () => void
  }): ReactNode
  /** How to log in to the agent's official account; absent = no 登录… button. */
  renderLogin?(p: { agent: AgentKind; onClose: () => void; onAddProvider: () => void }): ReactNode
  /** Opens a bot of 使用它的 Bot; absent = names only. */
  openBot?(id: string): void
}
