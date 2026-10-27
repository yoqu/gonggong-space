import { Suspense, useState } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { lazyTerminalUI } from '../../terminal/lazy'
import { patchTerminalSession } from '../../terminal/TerminalView'
import type { TerminalViewProps } from '../../terminal/view'
import type { TabMeta, TabProps } from '../types'

const terminalUI = lazyTerminalUI<TerminalViewProps>(() =>
  import('../../terminal/TerminalView').then((module) => ({ default: module.TerminalViewGuard })),
)

export function TerminalTab({ tab, active }: TabProps<'terminal'>) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const [initialSession] = useState(tab.sessionId)
  return (
    <Suspense fallback={null}>
      <terminalUI.Component
        sessionId={initialSession}
        groupId={groupId}
        botId={tab.botId}
        active={active}
        onSession={(sessionId) => patchTerminalSession(groupId, tab.botId, sessionId)}
      />
    </Suspense>
  )
}

export function useTerminalTabMeta(tab: TabProps<'terminal'>['tab']): TabMeta {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId))
  return { icon: 'square-terminal', title: t('终端 · {name}', { name: bot?.name ?? t('未知 Bot') }) }
}
