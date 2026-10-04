import type { SyncReplicaState, SyncStatusDto, SyncVersionTag } from '@gonggong/protocol'
import { t } from '../../i18n'
import type { TagTone } from '../../ui'

export const STATE: Record<SyncReplicaState, { label: string; tone: TagTone }> = {
  consistent: { label: t('一致'), tone: 'green' },
  syncing: { label: t('同步中'), tone: 'blue' },
  behind: { label: t('落后'), tone: 'orange' },
  drift: { label: t('本地有改动'), tone: 'orange' },
  conflict: { label: t('冲突待处理'), tone: 'red' },
  excluded: { label: t('不参与'), tone: 'gray' },
  offline: { label: t('离线'), tone: 'gray' },
}

export const TAG: Record<SyncVersionTag, string> = {
  init: t('初始'),
  auto_merge: t('自动合并'),
  interrupted: t('中断'),
  local: t('本地修改'),
  merge: t('合并'),
}

const ISSUES = [
  ['conflict', (n: number) => t('{n} 冲突', { n })],
  ['syncing', (n: number) => t('{n} 同步中', { n })],
  ['behind', (n: number) => t('{n} 落后', { n })],
  ['drift', (n: number) => t('{n} 本地有改动', { n })],
  ['offline', (n: number) => t('{n} 离线', { n })],
] as const

/** Replica counts worth flagging, worst first, e.g. `1 冲突`. */
export function issues(s: SyncStatusDto) {
  return ISSUES.flatMap(([state, text]) => {
    const n = s.replicas.filter((r) => r.state === state).length
    return n ? [{ state, text: text(n) }] : []
  })
}
