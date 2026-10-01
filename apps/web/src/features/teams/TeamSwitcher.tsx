import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { storedTeam } from '../../lib/team'
import { Alert, Badge, Icon, MenuButton, type MenuItem, Presence, Sheet, TextField } from '../../ui'
import { switchTeam, teamsApi, tokenOf } from './store'
import { TeamAvatar, TeamSettingsDialog } from './TeamSettingsDialog'
import './teams.css'

/** The switcher replaces the app title unless the deployment runs in single-team mode (plan D11). */
export const useMultiTeam = () => useSession((s) => !!s.tenancy && !s.tenancy.singleTeamMode)

export function TeamSwitcher() {
  const tenancy = useSession((s) => s.tenancy)
  const [open, setOpen] = useState<'settings' | 'new' | 'join' | null>(null)
  if (!tenancy || tenancy.singleTeamMode) return null
  const { teams } = tenancy
  const current = teams.find((x) => x.id === storedTeam()) ?? teams[0]
  if (!current) return null
  const othersUnread = teams.some((x) => x.id !== current.id && x.unread > 0)
  const items: MenuItem[] = [
    { header: t('切换团队') },
    ...teams.map((x) => ({
      value: `team:${x.id}`,
      checked: x.id === current.id,
      label: (
        <span className="team-menu__row">
          {x.name}
          {x.id === current.id ? null : <Badge count={x.unread} />}
        </span>
      ),
    })),
    { separator: true },
    { label: t('团队设置'), value: 'settings', icon: 'gear' },
    ...(tenancy.canCreateTeam ? [{ label: t('新建团队'), value: 'new', icon: 'plus' as const }] : []),
    { label: t('加入团队'), value: 'join', icon: 'person-add' },
  ]
  const select = (value: string) => {
    if (value.startsWith('team:')) {
      const id = value.slice(5)
      if (id !== current.id) switchTeam(id)
    } else setOpen(value as 'settings' | 'new' | 'join')
  }
  return (
    <>
      <MenuButton
        className="team-switch"
        aria-label={t('切换团队，当前：{name}', { name: current.name })}
        items={items}
        onSelect={select}
      >
        <TeamAvatar team={current} size={22} />
        <span className="team-switch__name">{current.name}</span>
        {othersUnread ? <span className="team-switch__dot" title={t('其他团队有未读')} /> : null}
        <Icon name="chevron-updown" size={12} />
      </MenuButton>
      <Presence>
        {open === 'settings' ? (
          <TeamSettingsDialog team={current} onClose={() => setOpen(null)} />
        ) : open === 'new' ? (
          <NewTeamSheet onClose={() => setOpen(null)} />
        ) : open === 'join' ? (
          <JoinTeamSheet onClose={() => setOpen(null)} />
        ) : null}
      </Presence>
    </>
  )
}

export function NewTeamSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      switchTeam((await teamsApi.create(name.trim())).id)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('新建团队')}
      message={t('你将成为团队所有者，可邀请成员加入。')}
      width={420}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: t('创建'),
          variant: 'primary',
          type: 'submit',
          form: 'new-team',
          disabled: busy || !name.trim(),
        },
      ]}
    >
      <form id="new-team" onSubmit={submit} noValidate>
        <TextField
          label={t('团队名称')}
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        {error ? <Alert variant="error" description={error} /> : null}
      </form>
    </Sheet>
  )
}

export function JoinTeamSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const token = tokenOf(text)
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('加入团队')}
      message={t('粘贴团队管理员发给你的邀请链接。')}
      width={420}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('下一步'), variant: 'primary', type: 'submit', form: 'join-team', disabled: !token },
      ]}
    >
      <form
        id="join-team"
        onSubmit={(e) => {
          e.preventDefault()
          if (token) navigate(`/join/${token}`)
        }}
        noValidate
      >
        <TextField
          label={t('邀请链接')}
          placeholder={`${location.origin}/join/…`}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </Sheet>
  )
}
