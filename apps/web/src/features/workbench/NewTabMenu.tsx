import { type KeyboardEvent, type ReactNode, useState } from 'react'
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
export function NewTabMenu({ className, children }: { className?: string; children: ReactNode }) {
  const groupId = useWorkbench((s) => s.groupId)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  const allBots = useWorkspace((s) => s.bots)
  const states = useWorkspace((s) => (groupId ? s.botStates[groupId] : undefined))
  const [linking, setLinking] = useState(false)
  const [addingGroupTab, setAddingGroupTab] = useState(false)
  const bots = (group?.botIds ?? []).flatMap((id) => allBots.filter((b) => b.id === id))
  const withGit = bots.filter((b) => states?.[b.id]?.git)
  const items: MenuItem[] = [
    { label: t('打开网页…'), value: 'link', icon: 'globe' },
    ...(group
      ? [{ label: t('添加群标签…'), value: 'group-tab', icon: 'tag' as const }, { separator: true as const }]
      : []),
    ...(bots.length
      ? [
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
      : []),
  ]
  const onSelect = (value: string) => {
    const [kind, botId = ''] = value.split(':')
    if (kind === 'link') setLinking(true)
    else if (kind === 'group-tab') setAddingGroupTab(true)
    else if (kind === 'files') openTab({ kind: 'files', botId, dir: '', selected: null })
    else openTab({ kind: 'git', botId })
  }
  return (
    <>
      <MenuButton
        aria-label={t('新建标签页')}
        title={t('新建标签页')}
        className={className}
        align="end"
        items={items}
        onSelect={onSelect}
      >
        {children}
      </MenuButton>
      <Presence>
        {linking ? <OpenLinkDialog onClose={() => setLinking(false)} /> : null}
        {addingGroupTab && group ? (
          <AddTabDialog group={group} onClose={() => setAddingGroupTab(false)} />
        ) : null}
      </Presence>
    </>
  )
}
