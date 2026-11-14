import { type AgentKind, fieldsFor, type MachineDto, type ProviderStoreView } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Alert, Skeleton } from '../../ui'
import { AGENT_LABEL, machineAgents, OWN_LOGIN, takesProviders } from '../bots/model'
import { AgentSettingsBox } from './AgentSettingsPanel'
import { ProviderBox } from './ProvidersPanel'
import { SwitchNote, switchLines } from './providers'
import { SaveStatus, useSaves } from './save'
import { ToolBox, useTools } from './ToolsPanel'

/** Agent 与供应商: Node.js on top, then one card per agent with its tool, providers and agent settings. */
export function AgentsPanel({ machine }: { machine: MachineDto }) {
  const has = (f: string) => machine.features.includes(f)
  const live = has('providers') || has('agentSettings')
  const tools = useTools(machine, has('tools'))
  const [view, setView] = useState<ProviderStoreView | null>(null)
  const [error, setError] = useState('')
  const base = `/machines/${machine.id}/providers`

  useEffect(() => {
    if (live) api.get<ProviderStoreView>(base).then(setView, (e) => setError(errorText(e)))
  }, [base, live])

  const saves = useSaves()
  // Switches at once; the sessions that keep the old provider until a new session are noted beside it.
  const switchDefault = (agent: AgentKind, choice: string, from: ProviderStoreView) =>
    saves.save(agent, async () => {
      const lines = switchLines(from, { agent, choice })
      setView(await api.put<ProviderStoreView>(`${base}/default`, { agent, choice }))
      return lines.length ? <SwitchNote lines={lines} /> : undefined
    })

  const failed = [tools.error, error].filter(Boolean).join('\n')
  if (failed) return <Alert variant="error" description={failed} />
  if ((has('tools') && !tools.state) || (live && !view)) return <Skeleton count={4} />
  return (
    <div className="mx">
      {tools.state ? (
        <section aria-label={t('运行环境')} className="mx-section">
          <span className="mx-section__head mx-sub">{t('运行环境')}</span>
          <section aria-label="Node.js">
            <ToolBox kind="node" state={tools.state} op={tools.op} onRun={tools.run} />
          </section>
        </section>
      ) : null}
      {machineAgents(machine).map((agent) => (
        <section key={agent} aria-label={AGENT_LABEL[agent]} className="mx-agent">
          {tools.state ? (
            <ToolBox kind={agent} state={tools.state} op={tools.op} onRun={tools.run} />
          ) : (
            <span className="mx-strong">{AGENT_LABEL[agent]}</span>
          )}
          {!takesProviders(agent) ? (
            <span className="mx-sub">{OWN_LOGIN[agent]}</span>
          ) : view && has('providers') ? (
            <ProviderBox
              machine={machine}
              agent={agent}
              view={view}
              onView={setView}
              status={<SaveStatus state={saves.status(agent)} />}
              onSwitch={(a, choice, v = view) => switchDefault(a, choice, v)}
            />
          ) : null}
          {view && has('agentSettings') && fieldsFor(agent, 'agent').length ? (
            <AgentSettingsBox machine={machine} agent={agent} view={view} onView={setView} />
          ) : null}
        </section>
      ))}
    </div>
  )
}
