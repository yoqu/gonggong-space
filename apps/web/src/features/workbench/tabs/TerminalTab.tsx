import { useState } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { patchTerminalSession, TerminalViewGuard } from '../../terminal/TerminalView'
import type { TabMeta, TabProps } from '../types'

export function TerminalTab({ tab, active }: TabProps<'terminal'>) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const [initialSession] = useState(tab.sessionId)
  return (
    <TerminalViewGuard
      sessionId={initialSession}
      groupId={groupId}
      botId={tab.botId}
      active={active}
      onSession={(sessionId) => patchTerminalSession(groupId, tab.botId, sessionId)}
    />
  )
}

export function useTerminalTabMeta(tab: TabProps<'terminal'>['tab']): TabMeta {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === tab.botId))
  return { icon: 'square-terminal', title: t('终端 · {name}', { name: bot?.name ?? t('未知 Bot') }) }
}
