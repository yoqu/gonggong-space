import { AgentsPanel } from '@web/features/agents/AgentsPanel'
import type { AgentsSource } from '@web/features/agents/source'
import { Icon, Skeleton } from '@web/ui'
import { useEffect, useState } from 'react'
import { desktopSource } from '../agentsSource'
import { t } from '../i18n'
import { ipc, type MachineBot } from '../ipc'
import { fail } from '../lib/ui'
import type { PageProps } from '.'

/** The Web's Agent page of a machine (same components), on this machine's files. */
export function AgentsPage(_: PageProps) {
  const [source, setSource] = useState<AgentsSource | null>(null)
  const [bots, setBots] = useState<MachineBot[]>([])

  useEffect(() => {
    ipc.agentFeatures().then((f) => setSource(desktopSource(f)), fail)
    ipc.bots().then(setBots, () => {})
  }, [])

  return (
    <>
      <p className="dk-note">
        <Icon name="info" size={14} />
        <span>
          {t(
            'Agent 是本机安装的 CLI 运行时，决定能用哪些模型；Bot 是团队里的身份，认领后调用这里的某个 agent 执行。',
          )}
        </span>
      </p>
      {source ? <AgentsPanel source={source} bots={bots} /> : <Skeleton variant="conversation" count={2} />}
    </>
  )
}
