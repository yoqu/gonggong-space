import type { UserDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { Avatar, MenuButton, type MenuItem, Presence } from '../../ui'
import { BindMachineDialog } from '../machines/BindMachineDialog'
import { useSettings } from '../settings/store'
import { TeamSettingsDialog } from '../teams/TeamSettingsDialog'
import { UsageDialog } from '../usage/UsagePage'
import { logout } from './logout'
import './account-menu.css'

export const ROLE_LABEL: Record<UserDto['role'], string> = {
  sysadmin: t('系统管理员'),
  member: t('普通成员'),
}

/** Avatar button with the glass account menu (Pane MenuButton + Menu); at the NavRail foot it opens upward. */
export function AccountMenu({
  size = 24,
  align = 'end',
  placement = 'below',
}: {
  size?: number
  align?: 'start' | 'end'
  placement?: 'below' | 'above'
}) {
  const user = useSession((s) => s.user)
  // Single-team mode has no team switcher, so 团队设置 lives here (plan D11).
  const soleTeam = useSession((s) => (s.tenancy?.singleTeamMode ? s.tenancy.teams[0] : undefined))
  const [dialog, setDialog] = useState<'bind' | 'usage' | 'team' | null>(null)
  const openSettings = useSettings((s) => s.open)

  if (!user) return null
  const items: MenuItem[] = [
    {
      header: (
        <span className="account__who">
          <span className="account__name">{user.name}</span>
          <span>{`${ROLE_LABEL[user.role]} · ${user.account}`}</span>
        </span>
      ),
    },
    { separator: true },
    { label: t('绑定新机器'), value: 'bind' },
    { label: t('我的用量'), value: 'usage' },
    ...(soleTeam ? [{ label: t('团队设置'), value: 'team' }] : []),
    { separator: true },
    { label: t('设置…'), value: 'settings' },
    { separator: true },
    { label: t('退出登录'), value: 'logout' },
  ]

  const select = (value: string) => {
    if (value === 'logout') void logout()
    else if (value === 'settings') openSettings()
    else setDialog(value as 'bind' | 'usage' | 'team')
  }

  return (
    <>
      <MenuButton
        className="account__trigger"
        aria-label={t('账户菜单')}
        title={user.name}
        align={align}
        placement={placement}
        items={items}
        onSelect={select}
      >
        <Avatar name={user.name} size={size} />
      </MenuButton>
      <BindMachineDialog open={dialog === 'bind'} onClose={() => setDialog(null)} />
      <Presence>
        {dialog === 'usage' ? (
          <UsageDialog onClose={() => setDialog(null)} />
        ) : dialog === 'team' && soleTeam ? (
          <TeamSettingsDialog team={soleTeam} onClose={() => setDialog(null)} />
        ) : null}
      </Presence>
    </>
  )
}
