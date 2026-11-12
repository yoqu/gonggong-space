import type { UserDto } from '@gonggong/protocol'
import { Suspense, useState } from 'react'
import { becomeBuilder, useIsBuilder } from '../../app/builder'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { named } from '../../lib/lazy'
import { dateLocale } from '../../lib/time'
import { Avatar, Icon, MenuButton, type MenuItem, Presence } from '../../ui'
import { NewBotDialog } from '../bots/lazy'
import { BindMachineDialog } from '../machines/lazy'
import { PAUSE_CHOICES, PauseDialog, pause, resume, usePausedUntil } from '../notifications/dnd'
import { useGuide } from '../onboarding/store'
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
  const [dialog, setDialog] = useState<'bind' | 'usage' | 'team' | 'invite' | 'pause' | null>(null)
  /** 新建 Bot on the machine just bound from 绑定新机器. */
  const [newBotOn, setNewBotOn] = useState<string | null>(null)
  const openSettings = useSettings((s) => s.open)
  const builder = useIsBuilder()
  const pausedUntil = usePausedUntil()

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
    pausedUntil
      ? {
          label: t('恢复通知（已暂停到 {time}）', {
            time: pausedUntil.toLocaleString(dateLocale, {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
          }),
          value: 'resume',
          icon: 'bell',
        }
      : {
          label: t('暂停通知'),
          icon: 'bell-slash',
          submenu: PAUSE_CHOICES.map(({ label, value }) => ({ label, value })),
        },
    { separator: true },
    builder ? { label: t('绑定新机器'), value: 'bind' } : { label: t('接入我的电脑'), value: 'build' },
    { label: t('我的用量'), value: 'usage' },
    { label: t('新手指引'), value: 'guide' },
    ...(soleTeam ? [{ label: t('团队设置'), value: 'team' }] : []),
    ...(soleTeam && soleTeam.role !== 'member' ? [{ label: t('邀请成员'), value: 'invite' }] : []),
    { separator: true },
    { label: t('设置…'), value: 'settings' },
    { separator: true },
    { label: t('退出登录'), value: 'logout' },
  ]

  const select = (value: string) => {
    const choice = PAUSE_CHOICES.find((c) => c.value === value)
    if (choice) {
      if (choice.until) void pause(choice.until())
      else setDialog('pause')
    } else if (value === 'resume') void resume()
    else if (value === 'logout') void logout()
    else if (value === 'settings') openSettings()
    else if (value === 'guide') useGuide.getState().show()
    else if (value === 'build') {
      becomeBuilder()
      setDialog('bind')
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
        {pausedUntil ? (
          <Icon name="bell-slash" size={10} className="account__paused" label={t('通知已暂停')} />
        ) : null}
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
        ) : dialog === 'pause' ? (
          <PauseDialog onClose={() => setDialog(null)} />
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
