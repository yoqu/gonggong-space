import { type ProviderSavedDto, ProviderStoreView } from '@gonggong/protocol'
import type { AgentsSource } from '@web/features/agents/source'
import { AgentLoginDialog } from '@web/features/machines/AgentLoginDialog'
import { useEffect } from 'react'
import { ipc, onToolProgress, type ProvidersCmd } from './ipc'
import { fail } from './lib/ui'

/** Tauri rejects with the command's message; the shared components expect an Error. */
const wrap = <T,>(p: Promise<T>): Promise<T> =>
  p.catch((e: unknown) => {
    throw e instanceof Error ? e : new Error(String(e))
  })

// The daemon leaves out empty maps (agentSettings, cli, official); the schema fills them in.
const view = (cmd: ProvidersCmd) => wrap(ipc.providers(cmd)).then((r) => ProviderStoreView.parse(r.view))
const saved = (cmd: ProvidersCmd) =>
  wrap(ipc.providers(cmd)).then((r) => ({ id: r.id ?? '', view: ProviderStoreView.parse(r.view) }))

/** The system folder dialog, open while mounted. */
function DirPicker({
  start,
  onPick,
  onClose,
}: {
  start: string | null
  onPick: (path: string) => void
  onClose: () => void
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: one dialog per mount
  useEffect(() => {
    ipc.pickDir(start).then(
      (path) => (path ? onPick(path) : onClose()),
      (e) => {
        fail(e)
        onClose()
      },
    )
  }, [])
  return null
}

/**
 * The desktop app's source of the shared Agent page: this machine's files through the gonggong crate, handled by the
 * same code as the daemon answers the Web with (`src-tauri/src/commands/{tools,providers}.rs`).
 */
export function desktopSource(features: string[]): AgentsSource {
  return {
    key: 'local',
    features,
    loadAgents: () => wrap(ipc.tools()),
    runTool: async (kind, op, onLine) => {
      const opId = `${kind}-${Date.now()}`
      const off = await onToolProgress(opId, onLine)
      try {
        return await wrap(ipc.runTool(op, kind, opId))
      } finally {
        off()
      }
    },
    loadProviders: () => view({ action: 'list' }),
    presets: () => wrap(ipc.providers({ action: 'presets' })).then((r) => r.presets ?? []),
    // Like the server for a client with protocolProviders: save the vendor, then make it each agent's default.
    saveProvider: async (id, { setDefault = [], agent: _legacy, ...fields }) => {
      const res: ProviderSavedDto = await saved({
        action: 'save',
        provider: id ? { ...fields, id } : fields,
      })
      for (const agent of setDefault) res.view = await view({ action: 'use', agent, choice: res.id })
      return res
    },
    removeProvider: (id) => view({ action: 'remove', id }),
    setDefault: (agent, choice, model) => view({ action: 'use', agent, choice, model }),
    saveOfficial: ({ agent, ...official }) => view({ action: 'official', agent, official }),
    saveAgentSettings: ({ agent, ...agentSettings }) =>
      view({ action: 'agentSettings', agent, agentSettings }),
    importLink: (link) => saved({ action: 'importLink', link, setDefault: false }),
    ccSwitch: features.includes('ccSwitch')
      ? {
          preview: () => wrap(ipc.ccSwitchPreview()),
          apply: (keys) => wrap(ipc.ccSwitchApply(keys)),
        }
      : undefined,
    claudeDirs: () => wrap(ipc.claudeDirs()),
    renderDirPicker: (p) => <DirPicker {...p} />,
    renderLogin: (p) => <AgentLoginDialog {...p} />,
    openBot: (id) => void ipc.openBotInWeb(id).catch(fail),
    agentLocal: (kind) => wrap(ipc.agentLocal(kind)),
    pickPath: (kind) => wrap(ipc.pickAgentPath(kind)),
    resetPath: (kind) => wrap(ipc.resetAgentPath(kind)),
    groupNames: () => wrap(ipc.groupNames()),
    confirmSwitch: true,
  }
}
