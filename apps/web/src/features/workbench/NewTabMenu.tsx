import { TERMINAL_FEATURE } from '@gonggong/protocol'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkbench } from '../../app/workbench'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Dialog, MenuButton, type MenuItem, Presence, TextField } from '../../ui'
import { AddTabDialog } from '../group-tabs/AddTabDialog'
import { openTab } from './open'

const LINK = /^https?:\/\/\S+$/i

/** A typed address: `example.com` means https. */
const normalize = (url: string) => {
  const v = url.trim()
  return !v || /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
}

function OpenLinkDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const link = normalize(url)
  const valid = LINK.test(link)
  const submit = () => {
    if (!valid) return
    if (openTab({ kind: 'link', url: link, title: title.trim() || new URL(link).host })) onClose()
  }
  const enter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    submit()
  }
  return (
    <Dialog
      open
      width={440}
      title={t('打开网页')}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('打开'), variant: 'primary', disabled: !valid, onClick: submit },
      ]}
    >
      <div className="git-form">
        <TextField
          label={t('网址')}
          placeholder="https://"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={enter}
        />
        <TextField
          label={t('标题（可选）')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={enter}
        />
      </div>
    </Dialog>
  )
}

/** ＋ of the workbench: a web page, or a bot's files or Git, in a new tab. */
export function NewTabMenu({
  className,
  align = 'start',
  children,
}: {
  className?: string
  /** Desktop opens rightward, inside the workbench; the phone's top-right ＋ opens leftward. */
  align?: 'start' | 'end'
  children: ReactNode
}) {
  const groupId = useWorkbench((s) => s.groupId)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  const allBots = useWorkspace((s) => s.bots)
  const machines = useWorkspace((s) => s.machines)
  const me = useSession((s) => s.user)
  const states = useWorkspace((s) => (groupId ? s.botStates[groupId] : undefined))
  const [linking, setLinking] = useState(false)
  const [addingGroupTab, setAddingGroupTab] = useState(false)
  const bots = (group?.botIds ?? []).flatMap((id) => allBots.filter((b) => b.id === id))
  const withGit = bots.filter((b) => states?.[b.id]?.git)
  const withTerminal = bots.filter((b) => {
    const machine = machines.find((m) => m.id === b.machineId)
    return (
      b.ownerId === me?.id &&
      machine?.online &&
      machine.os !== 'windows' &&
      machine.features.includes(TERMINAL_FEATURE)
    )
  })
  const canAddGroupTab = !!group && group.kind !== 'dm'
  const items: MenuItem[] = [
    { label: t('打开网页…'), value: 'link', icon: 'globe' },
    ...(canAddGroupTab ? [{ label: t('添加群标签…'), value: 'group-tab', icon: 'tag' as const }] : []),
    ...(bots.length
      ? [
          { separator: true as const },
          { header: t('浏览文件') },
          ...bots.map((b) => ({ label: b.name, value: `files:${b.id}`, icon: 'folder' as const })),
        ]
      : []),
    ...(withGit.length
      ? [
          { separator: true as const },
          { header: t('Git 面板') },
          ...withGit.map((b) => ({ label: b.name, value: `git:${b.id}`, icon: 'git-branch' as const })),
        ]
      : bots.length
        ? (() => {
            const anyOnline = bots.some((b) => machines.find((m) => m.id === b.machineId)?.online)
            const reason = anyOnline ? t('还没有工作区') : t('机器离线')
            return [
              { separator: true as const },
              {
                value: 'git:disabled',
                icon: 'git-branch' as const,
                disabled: true,
                title: reason,
                label: (
                  <span className="bench-menu__disabled">
                    <span>{t('Git 面板')}</span>
                    <span className="bench-menu__sub">{reason}</span>
                  </span>
                ),
              },
            ]
          })()
        : []),
    ...(withTerminal.length
      ? [
          { separator: true as const },
          { header: t('新建终端') },
          ...withTerminal.map((b) => ({
            label: b.name,
            value: `terminal:${b.id}`,
            icon: 'square-terminal' as const,
          })),
        ]
      : []),
  ]
  const onSelect = (value: string) => {
    const [kind, botId = ''] = value.split(':')
    if (kind === 'link') setLinking(true)
    else if (kind === 'group-tab') setAddingGroupTab(true)
    else if (kind === 'files') openTab({ kind: 'files', botId, dir: '', selected: null })
    else if (kind === 'terminal') openTab({ kind: 'terminal', botId })
    else openTab({ kind: 'git', botId })
  }
  return (
    <>
      <MenuButton
        aria-label={t('新建标签页')}
        title={t('新建标签页')}
        className={className}
        align={align}
        items={items}
        onSelect={onSelect}
      >
        {children}
      </MenuButton>
      <Presence>{linking ? <OpenLinkDialog onClose={() => setLinking(false)} /> : null}</Presence>
      <Presence>
        {addingGroupTab && group && group.kind !== 'dm' ? (
          <AddTabDialog group={group} onClose={() => setAddingGroupTab(false)} />
        ) : null}
      </Presence>
    </>
  )
}
