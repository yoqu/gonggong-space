import type { UserDto } from '@gonggong/protocol'
import {
  BarChart3,
  Check,
  Droplet,
  KeyRound,
  Layers,
  Link2,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Sun,
} from 'lucide-react'
import { useState } from 'react'
import { type GlassPreference, getGlass, setGlass } from '../../app/glass'
import { useSession } from '../../app/session'
import { getTheme, setTheme, type ThemePreference } from '../../app/theme'
import { Presence, useEscape, usePresence } from '../../ui'
import { BindMachineDialog } from '../machines/BindMachineDialog'
import { UsageDialog } from '../usage/UsagePage'
import { ChangePasswordDialog } from './ChangePasswordPage'
import { logout } from './logout'
import './auth.css'
import './account-menu.css'

export const ROLE_LABEL: Record<UserDto['role'], string> = { sysadmin: '系统管理员', member: '普通成员' }

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
]

const GLASS_OPTIONS: { value: GlassPreference; label: string; Icon: typeof Sun }[] = [
  { value: 'clear', label: '清透', Icon: Droplet },
  { value: 'standard', label: '标准', Icon: Layers },
  { value: 'tinted', label: '着色', Icon: Palette },
]

/** Avatar button + dropdown (Web 对话.dc.html ovMenu). */
export function AccountMenu() {
  const user = useSession((s) => s.user)
  const [open, setOpen] = useState(false)
  const [binding, setBinding] = useState(false)
  const [usage, setUsage] = useState(false)
  const [password, setPassword] = useState(false)
  const [theme, setThemeState] = useState<ThemePreference>(getTheme)
  const [glass, setGlassState] = useState<GlassPreference>(getGlass)

  useEscape(() => setOpen(false), open)
  const menu = usePresence(open)

  const toggleOpen = () => {
    // re-read on open so the marker reflects changes made elsewhere (e.g. desktop settings)
    if (!open) {
      setThemeState(getTheme())
      setGlassState(getGlass())
    }
    setOpen(!open)
  }

  const chooseTheme = (value: ThemePreference) => {
    setTheme(value)
    setThemeState(value)
  }

  const chooseGlass = (value: GlassPreference) => {
    setGlass(value)
    setGlassState(value)
  }

  if (!user) return null
  return (
    <div className="account">
      <button
        type="button"
        className="topbar__avatar"
        aria-label="账户菜单"
        aria-expanded={open}
        title={user.name}
        onClick={toggleOpen}
      >
        {Array.from(user.name)[0]}
      </button>
      {menu.mounted ? (
        <>
          {open ? (
            <div className="account__backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          ) : null}
          <div
            className="account__menu ui-popover"
            data-testid="account-menu"
            data-state={menu.state}
            onAnimationEnd={menu.onAnimationEnd}
          >
            <div className="account__who">
              <span className="account__name">{user.name}</span>
              <span className="account__sub">{`${ROLE_LABEL[user.role]} · ${user.account}`}</span>
            </div>
            <div className="account__sep" />
            <button
              type="button"
              className="account__item"
              onClick={() => {
                setOpen(false)
                setBinding(true)
              }}
            >
              <Link2 size={13} />
              绑定新机器
            </button>
            <button
              type="button"
              className="account__item"
              onClick={() => {
                setOpen(false)
                setUsage(true)
              }}
            >
              <BarChart3 size={13} />
              我的用量
            </button>
            <button
              type="button"
              className="account__item"
              onClick={() => {
                setOpen(false)
                setPassword(true)
              }}
            >
              <KeyRound size={13} />
              修改密码
            </button>
            <div className="account__sep" />
            <div className="account__label">外观</div>
            {THEME_OPTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={theme === value}
                className="account__item"
                onClick={() => chooseTheme(value)}
              >
                <Icon size={13} />
                {label}
                {theme === value ? <Check size={13} className="account__check" aria-hidden="true" /> : null}
              </button>
            ))}
            <div className="account__label">玻璃效果</div>
            {GLASS_OPTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={glass === value}
                className="account__item"
                onClick={() => chooseGlass(value)}
              >
                <Icon size={13} />
                {label}
                {glass === value ? <Check size={13} className="account__check" aria-hidden="true" /> : null}
              </button>
            ))}
            <div className="account__sep" />
            <button type="button" className="account__item" onClick={() => void logout()}>
              <LogOut size={13} />
              退出登录
            </button>
          </div>
        </>
      ) : null}
      <BindMachineDialog open={binding} onClose={() => setBinding(false)} />
      <Presence>{usage ? <UsageDialog onClose={() => setUsage(false)} /> : null}</Presence>
      <Presence>{password ? <ChangePasswordDialog onClose={() => setPassword(false)} /> : null}</Presence>
    </div>
  )
}
