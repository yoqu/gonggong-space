import type { UserDto } from '@aiws/protocol'
import { Bot, Check, Link2, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useSession } from '../../app/session'
import { getTheme, setTheme, type ThemePreference } from '../../app/theme'
import { useEscape } from '../../ui'
import { BindMachineDialog } from '../machines/BindMachineDialog'
import { logout } from './logout'
import './auth.css'
import './account-menu.css'

export const ROLE_LABEL: Record<UserDto['role'], string> = { sysadmin: '系统管理员', member: '普通成员' }

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
]

/** Avatar button + dropdown (Web 对话.dc.html ovMenu). */
export function AccountMenu() {
  const user = useSession((s) => s.user)
  const [open, setOpen] = useState(false)
  const [binding, setBinding] = useState(false)
  const [theme, setThemeState] = useState<ThemePreference>(getTheme)

  useEscape(() => setOpen(false), open)

  const toggleOpen = () => {
    // re-read on open so the marker reflects changes made elsewhere (e.g. desktop settings)
    if (!open) setThemeState(getTheme())
    setOpen(!open)
  }

  const chooseTheme = (value: ThemePreference) => {
    setTheme(value)
    setThemeState(value)
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
      {open ? (
        <>
          <div className="account__backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="account__menu" data-testid="account-menu">
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
            <Link to="/admin/bots" className="account__item" onClick={() => setOpen(false)}>
              <Bot size={13} />
              我的 bot 与用量
            </Link>
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
            <div className="account__sep" />
            <button type="button" className="account__item" onClick={() => void logout()}>
              <LogOut size={13} />
              退出登录
            </button>
          </div>
        </>
      ) : null}
      <BindMachineDialog open={binding} onClose={() => setBinding(false)} />
    </div>
  )
}
