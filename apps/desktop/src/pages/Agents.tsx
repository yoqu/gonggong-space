import { AgentsPanel } from '@web/features/agents/AgentsPanel'
import { Alert, Icon, Skeleton } from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { desktopSource } from '../agentsSource'
import { t } from '../i18n'
import { ipc, type MachineBot } from '../ipc'
import { useIpc } from '../lib/useIpc'
import type { PageProps } from '.'

/** The Web's Agent page of a machine (same components), on this machine's files. */
export function AgentsPage(_: PageProps) {
  const loadSource = useCallback(() => ipc.agentFeatures().then(desktopSource), [])
  const sourceQ = useIpc(loadSource)
  const [bots, setBots] = useState<MachineBot[]>([])

  useEffect(() => {
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
      {sourceQ.data ? (
        <AgentsPanel source={sourceQ.data} bots={bots} />
      ) : sourceQ.error ? (
        <Alert
          variant="error"
          description={sourceQ.error}
          retrying={sourceQ.loading}
          onRetry={() => void sourceQ.reload()}
        />
      ) : (
        <Skeleton variant="conversation" count={2} />
      )}
    </>
  )
}
