import type { UserDto } from '@gonggong/protocol'
import { useState } from 'react'
import { type GlassPreference, getGlass, setGlass } from '../../app/glass'
import { useSession } from '../../app/session'
import { getTheme, setTheme, type ThemePreference } from '../../app/theme'
import { Avatar, MenuButton, type MenuItem, Presence } from '../../ui'
import { BindMachineDialog } from '../machines/BindMachineDialog'
import { UsageDialog } from '../usage/UsagePage'
import { ChangePasswordDialog } from './ChangePasswordPage'
import { logout } from './logout'
import './account-menu.css'

export const ROLE_LABEL: Record<UserDto['role'], string> = { sysadmin: '系统管理员', member: '普通成员' }

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const GLASS_OPTIONS: { value: GlassPreference; label: string }[] = [
  { value: 'clear', label: '清透' },
  { value: 'standard', label: '标准' },
  { value: 'tinted', label: '着色' },
]

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
  const [dialog, setDialog] = useState<'bind' | 'usage' | 'password' | null>(null)
  const [theme, setThemeState] = useState<ThemePreference>(getTheme)
  const [glass, setGlassState] = useState<GlassPreference>(getGlass)

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
    { label: '绑定新机器', value: 'bind' },
    { label: '我的用量', value: 'usage' },
    { label: '修改密码…', value: 'password' },
    { separator: true },
    { header: '外观' },
    ...THEME_OPTIONS.map((o) => ({ label: o.label, value: `theme:${o.value}`, checked: theme === o.value })),
    { separator: true },
    { header: '玻璃效果' },
    ...GLASS_OPTIONS.map((o) => ({ label: o.label, value: `glass:${o.value}`, checked: glass === o.value })),
    { separator: true },
    { label: '退出登录', value: 'logout' },
  ]

  const select = (value: string) => {
    const [kind, option] = value.split(':')
    if (kind === 'theme') {
      setTheme(option as ThemePreference)
      setThemeState(option as ThemePreference)
    } else if (kind === 'glass') {
      setGlass(option as GlassPreference)
      setGlassState(option as GlassPreference)
    } else if (kind === 'logout') void logout()
    else setDialog(kind as 'bind' | 'usage' | 'password')
  }

  return (
    <>
      <MenuButton
        className="account__trigger"
        aria-label="账户菜单"
        title={user.name}
        align={align}
        placement={placement}
        items={items}
        onSelect={select}
        onOpenChange={(open) => {
          // re-read on open so the marks reflect changes made elsewhere (e.g. desktop settings)
          if (!open) return
          setThemeState(getTheme())
          setGlassState(getGlass())
        }}
      >
        <Avatar name={user.name} size={size} />
      </MenuButton>
      <BindMachineDialog open={dialog === 'bind'} onClose={() => setDialog(null)} />
      <Presence>{dialog === 'usage' ? <UsageDialog onClose={() => setDialog(null)} /> : null}</Presence>
      <Presence>
        {dialog === 'password' ? <ChangePasswordDialog onClose={() => setDialog(null)} /> : null}
      </Presence>
    </>
  )
}
