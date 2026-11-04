import { fieldsFor, type MachineDto, type ProviderStoreView } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Alert, Skeleton, toast } from '../../ui'
import { AGENT_LABEL, AGENTS } from '../bots/model'
import { AgentSettingsBox } from './AgentSettingsPanel'
import { ProviderBox } from './ProvidersPanel'
import { useProviderSwitch } from './providers'
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

  const switcher = useProviderSwitch(async ({ agent, choice }) => {
    try {
      setView(await api.put<ProviderStoreView>(`${base}/default`, { agent, choice }))
      toast({
        type: 'success',
        message: t('{agent} 在该机器的默认已切换，新会话生效', { agent: AGENT_LABEL[agent] }),
      })
    } catch (e) {
      toastError(e)
    }
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
      {AGENTS.map((agent) => (
        <section key={agent} aria-label={AGENT_LABEL[agent]} className="mx-agent">
          {tools.state ? (
            <ToolBox kind={agent} state={tools.state} op={tools.op} onRun={tools.run} />
          ) : (
            <span className="mx-strong">{AGENT_LABEL[agent]}</span>
          )}
          {view && has('providers') ? (
            <ProviderBox
              machine={machine}
              agent={agent}
              view={view}
              onView={setView}
              onSwitch={(a, choice, v = view) => switcher.request({ agent: a, choice }, v)}
            />
          ) : null}
          {view && has('agentSettings') && fieldsFor(agent, 'agent').length ? (
            <AgentSettingsBox machine={machine} agent={agent} view={view} onView={setView} />
          ) : null}
        </section>
      ))}
      {switcher.dialog}
    </div>
  )
}
