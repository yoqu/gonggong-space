import type { UserDto } from '@gonggong/protocol'
import { Suspense, useState } from 'react'
import { useNavigate } from 'react-router'
import { becomeBuilder, useIsBuilder } from '../../app/builder'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { named } from '../../lib/lazy'
import { Avatar, MenuButton, type MenuItem, Presence } from '../../ui'
import { NewBotDialog } from '../bots/lazy'
import { BindMachineDialog } from '../machines/lazy'
import { useSettings } from '../settings/store'
import { TeamSettingsDialog } from '../teams/lazy'
import { logout } from './logout'
import './account-menu.css'

const UsageDialog = named(() => import('../usage/UsagePage'), 'UsageDialog')

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
  const [dialog, setDialog] = useState<'bind' | 'usage' | 'team' | 'invite' | null>(null)
  /** 新建 Bot on the machine just bound from 绑定新机器. */
  const [newBotOn, setNewBotOn] = useState<string | null>(null)
  const openSettings = useSettings((s) => s.open)
  const builder = useIsBuilder()
  const navigate = useNavigate()

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
    ...(builder ? [] : [{ label: t('搭建自己的 Bot'), value: 'build' }]),
    { label: t('绑定新机器'), value: 'bind' },
    { label: t('我的用量'), value: 'usage' },
    ...(soleTeam ? [{ label: t('团队设置'), value: 'team' }] : []),
    ...(soleTeam && soleTeam.role !== 'member' ? [{ label: t('邀请成员'), value: 'invite' }] : []),
    { separator: true },
    { label: t('设置…'), value: 'settings' },
    { separator: true },
    { label: t('退出登录'), value: 'logout' },
  ]

  const select = (value: string) => {
    if (value === 'logout') void logout()
    else if (value === 'settings') openSettings()
    else if (value === 'build') {
      becomeBuilder()
      navigate('/machines')
    } else setDialog(value as 'bind' | 'usage' | 'team' | 'invite')
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
        <Avatar name={user.name} src={user.avatar ?? undefined} size={size} />
      </MenuButton>
      <Presence>
        {dialog === 'bind' ? (
          <Suspense fallback={null}>
            <BindMachineDialog
              open
              onClose={() => setDialog(null)}
              onNewBot={(machineId) => {
                setDialog(null)
                setNewBotOn(machineId)
              }}
            />
          </Suspense>
        ) : dialog === 'usage' ? (
          <Suspense fallback={null}>
            <UsageDialog onClose={() => setDialog(null)} />
          </Suspense>
        ) : (dialog === 'team' || dialog === 'invite') && soleTeam ? (
          <Suspense fallback={null}>
            <TeamSettingsDialog
              team={soleTeam}
              tab={dialog === 'invite' ? 'invites' : 'overview'}
              onClose={() => setDialog(null)}
            />
          </Suspense>
        ) : null}
      </Presence>
      <Presence>
        {newBotOn ? (
          <Suspense fallback={null}>
            <NewBotDialog me={user} machineId={newBotOn} onClose={() => setNewBotOn(null)} />
          </Suspense>
        ) : null}
      </Presence>
    </>
  )
}
