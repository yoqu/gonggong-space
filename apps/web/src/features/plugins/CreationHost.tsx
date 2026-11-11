import type { GroupDto, MessageDto } from '@gonggong/protocol'
import { Suspense, useEffect } from 'react'
import { named } from '../../lib/lazy'
import { Presence } from '../../ui'
import { closeCreation, useCreation, useCreationPlugins } from './store'

const CreationSheet = named(() => import('./CreationSheet'), 'CreationSheet')

/** The 创作 panel of the group, opened from the composer, `/` candidates or a creation card. */
export function CreationHost({ group, onSent }: { group: GroupDto; onSent: (m: MessageDto) => void }) {
  const open = useCreation((s) => (s.open?.groupId === group.id ? s.open : null))
  const plugins = useCreationPlugins(group.id)
  // Leaving the group drops the panel rather than reopening it on return.
  useEffect(() => closeCreation, [])
  return (
    <Presence>
      {open && plugins.length ? (
        <Suspense fallback={null}>
          <CreationSheet group={group} plugins={plugins} open={open} onSent={onSent} />
        </Suspense>
      ) : null}
    </Presence>
  )
}
