import type {
  AgentKind,
  AgentLoginStartedDto,
  AgentSettingsReq,
  CcSwitchImportedDto,
  CcSwitchPreviewDto,
  DirListingDto,
  MachineAgentsDto,
  MachineDto,
  OfficialProviderReq,
  ProviderPreset,
  ProviderSavedDto,
  ProviderStoreView,
  SaveProviderReq,
  ToolOpDto,
} from '@gonggong/protocol'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { AgentLoginDialog } from '../machines/AgentLoginDialog'
import { DirPicker, join } from '../workspaces/DirPicker'
import { AgentsPanel } from './AgentsPanel'
import type { AgentLoginDriver, AgentsSource } from './source'

/** Web login driver: relays native ACP login to the machine's daemon via server HTTP + WS. */
export function webLoginDriver(machine: MachineDto): AgentLoginDriver {
  const id = machine.id
  return {
    mode: 'web',
    supportsAcp: machine.online && machine.features.includes('agent_login'),
    startAcp: async ({ kind, methodId, openBrowser }) => {
      const res = await api.post<AgentLoginStartedDto>(`/machines/${id}/agents/${kind}/login`, {
        methodId,
        openBrowser,
      })
      return { opId: res.opId }
    },
    cancelAcp: async (kind, opId) => {
      await api.post(`/machines/${id}/agents/${kind}/login/cancel`, { opId })
    },
    subscribeAcp: (cb) =>
      realtime.subscribe((e) => {
        if (
          e.t !== 'machine.agentLogin.methods' &&
          e.t !== 'machine.agentLogin.auth' &&
          e.t !== 'machine.agentLogin.progress' &&
          e.t !== 'machine.agentLogin.result'
        )
          return
        if (e.machineId !== id) return
        if (e.t === 'machine.agentLogin.methods')
          cb({ t: 'agent.login.methods', opId: e.opId, kind: e.kind, methods: e.methods })
        else if (e.t === 'machine.agentLogin.auth')
          cb({ t: 'agent.login.auth', opId: e.opId, kind: e.kind, url: e.url, methodId: e.methodId })
        else if (e.t === 'machine.agentLogin.progress')
          cb({ t: 'agent.login.progress', opId: e.opId, kind: e.kind, stage: e.stage, line: e.line })
        else
          cb({
            t: 'agent.login.result',
            opId: e.opId,
            kind: e.kind,
            ok: e.ok,
            error: e.error,
            user: e.user,
          })
      }),
    openExternalUrl: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
  }
}

/** The web's source: everything is relayed live to the machine's daemon by the server, nothing is kept there. */
export function machineSource(machine: MachineDto, openBot?: (id: string) => void): AgentsSource {
  const id = machine.id
  const tools = `/machines/${id}/tools`
  const providers = `/machines/${id}/providers`
  return {
    key: id,
    features: machine.features,
    // A client without `tools` lists what it reported, with nothing to install.
    loadAgents: () =>
      machine.features.includes('tools')
        ? api.get<MachineAgentsDto>(tools)
        : Promise.resolve({
            node: null,
            agents: machine.agents,
            settings: { mirror: { kind: 'npmmirror' } },
          }),
    runTool: (kind, op, onLine) =>
      new Promise((resolve, reject) => {
        // Lines of this machine arriving before the server names the op are ours: it runs one at a time.
        let opId: string | null = null
        const off = realtime.subscribe((e) => {
          if (e.t !== 'machine.tools.progress' && e.t !== 'machine.tools.result') return
          if (e.machineId !== id || (opId !== null && e.opId !== opId)) return
          if (e.t === 'machine.tools.progress') return onLine(e.line)
          off()
          if (e.ok) resolve(e.state)
          else reject(new Error(e.error ?? t('安装失败')))
        })
        api.post<ToolOpDto>(`${tools}/${kind}/${op}`, {}).then(
          (r) => {
            opId = r.opId
          },
          (e) => {
            off()
            reject(e)
          },
        )
      }),
    loadProviders: () => api.get<ProviderStoreView>(providers),
    presets: () => api.get<ProviderPreset[]>(`${providers}/presets`),
    saveProvider: (pid, body: SaveProviderReq) =>
      pid
        ? api.put<ProviderSavedDto>(`${providers}/${pid}`, body)
        : api.post<ProviderSavedDto>(providers, body),
    removeProvider: (pid) => api.del<ProviderStoreView>(`${providers}/${pid}`),
    setDefault: (agent, choice, model) =>
      api.put<ProviderStoreView>(`${providers}/default`, { agent, choice, model }),
    saveOfficial: (body: OfficialProviderReq) => api.put<ProviderStoreView>(`${providers}/official`, body),
    saveAgentSettings: (body: AgentSettingsReq) =>
      api.put<ProviderStoreView>(`/machines/${id}/agent-settings`, body),
    importLink: (link) => api.post<ProviderSavedDto>(`${providers}/import-link`, { link, setDefault: false }),
    ccSwitch: machine.features.includes('ccSwitch')
      ? {
          preview: () => api.get<CcSwitchPreviewDto>(`/machines/${id}/ccswitch`).then((r) => r.candidates),
          // The default is switched afterwards, through the same confirmation as any other switch.
          apply: (keys) =>
            api.post<CcSwitchImportedDto>(`/machines/${id}/ccswitch/apply`, { keys, setDefault: false }),
        }
      : undefined,
    // The home's hidden Claude directories, not the official login's own `~/.claude`.
    claudeDirs: () =>
      api
        .get<DirListingDto>(`/machines/${id}/dirs?hidden=1`)
        .then((d) =>
          d.entries
            .filter((e) => /^\..*claude/i.test(e.name) && e.name !== '.claude')
            .map((e) => join(d.path, e.name)),
        ),
    // An older daemon would still give it a CLAUDE_CONFIG_DIR of its own, losing the home's MCP servers.
    claudeDefaultDir: machine.features.includes('claudeDefaultDir')
      ? () =>
          api.get<DirListingDto>(`/machines/${id}/dirs?hidden=1`).then((d) => ({
            path: join(d.path, '.claude'),
            exists: d.entries.some((e) => e.name === '.claude'),
          }))
      : undefined,
    renderDirPicker: ({ start, onPick, onClose }) => (
      <DirPicker
        machineId={id}
        title={t('选择配置目录')}
        start={start}
        hidden
        hint={t('进入配置目录后选择')}
        onPick={onPick}
        onClose={onClose}
      />
    ),
    renderLogin: ({ agent, agentState, onClose, onAddProvider, onLoggedIn }) => (
      <AgentLoginDialog
        machine={machine}
        agent={agent}
        agentState={agentState}
        loginDriver={webLoginDriver(machine)}
        onClose={onClose}
        onAddProvider={onAddProvider}
        onLoggedIn={onLoggedIn}
      />
    ),
    openBot,
  }
}

/** The source of `machine`, kept while its id and features stay the same. */
export function useMachineSource(machine: MachineDto) {
  const navigate = useNavigate()
  const features = machine.features.join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt only when what it serves changes
  return useMemo(
    () => machineSource(machine, (bot) => navigate(`/bot/${bot}`)),
    [machine.id, features, machine.online],
  )
}

/** The Agent page of a machine on the web, with the bots the member sees on it. */
export function MachineAgentsPanel({
  machine,
  initialOpen,
  initialLogin,
  onInitialLoginHandled,
}: {
  machine: MachineDto
  initialOpen?: AgentKind | null
  initialLogin?: AgentKind | null
  onInitialLoginHandled?: () => void
}) {
  const source = useMachineSource(machine)
  const all = useWorkspace((s) => s.bots)
  const bots = useMemo(() => all.filter((b) => b.machineId === machine.id), [all, machine.id])
  return (
    <AgentsPanel
      source={source}
      bots={bots}
      initialOpen={initialOpen}
      initialLogin={initialLogin}
      onInitialLoginHandled={onInitialLoginHandled}
    />
  )
}
