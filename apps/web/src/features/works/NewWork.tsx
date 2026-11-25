import type { CreationRes, WorkGroupDto } from '@gonggong/protocol'
import { Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { named } from '../../lib/lazy'
import { Dialog, Presence, Select } from '../../ui'
import { closeCreation, loadPlugins, openCreation, useCreation, useCreationPlugins } from '../plugins/store'

const CreationSheet = named(() => import('../plugins/CreationSheet'), 'CreationSheet')

const LAST = 'gg.works.newIn'

/**
 * 新建: where to create. A private chat with a bot needs no group: its creation panel opens right here and the work
 * opens in its editor once made; a group still creates in its chat.
 */
export function NewWorkDialog({ groups, onClose }: { groups: WorkGroupDto[]; onClose: () => void }) {
  const navigate = useNavigate()
  const last = localStorage.getItem(LAST)
  const [target, setTarget] = useState<string | null>(
    groups.find((g) => g.id === last)?.id ?? groups.find((g) => g.kind === 'dm')?.id ?? groups[0]?.id ?? null,
  )
  const options = groups.map((g) => ({
    value: g.id,
    label:
      g.kind === 'dm'
        ? t('{bot}（私聊，不用建群）', { bot: g.title })
        : t('群「{group}」', { group: g.title }),
  }))
  const go = () => {
    const g = groups.find((x) => x.id === target)
    if (!g) return
    localStorage.setItem(LAST, g.id)
    onClose()
    if (g.kind === 'group') navigate(`/g/${g.id}`)
    openCreation({ groupId: g.id })
  }
  return (
    <Dialog
      open
      title={t('新建作品')}
      message={t('选一个 Bot 直接创作，作品做好后在作品页编辑；也可以到群里和大家一起创作')}
      width={440}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('下一步'), variant: 'primary', disabled: !target, onClick: go },
      ]}
    >
      <Select label={t('交给谁')} options={options} value={target} onChange={setTarget} />
    </Dialog>
  )
}

/** The creation panel of a private chat opened from 作品 新建; the made work opens in its editor. */
export function WorkCreationHost({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate()
  const open = useCreation((s) => s.open)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === open?.groupId && g.kind === 'dm'))
  const groupId = group?.id
  useEffect(() => {
    if (groupId) loadPlugins(groupId)
  }, [groupId])
  const plugins = useCreationPlugins(groupId ?? '')
  // Leaving 作品 drops a private chat's panel, but not one 新建 just opened in a group's chat.
  useEffect(
    () => () => {
      const id = useCreation.getState().open?.groupId
      if (useWorkspace.getState().groups.some((g) => g.id === id && g.kind === 'dm')) closeCreation()
    },
    [],
  )
  return (
    <Presence>
      {open && group && plugins.length ? (
        <Suspense fallback={null}>
          <CreationSheet
            group={group}
            plugins={plugins}
            open={open}
            onSent={(m) => {
              const id = (m as CreationRes).artifactId
              onCreated()
              navigate(id ? `/works/${id}` : `/g/${group.id}`)
            }}
          />
        </Suspense>
      ) : null}
    </Presence>
  )
}
