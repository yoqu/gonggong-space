import type { UserDto } from '@aiws/protocol'
import { Bot, Link2, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useSession } from '../../app/session'
import { BindMachineDialog } from '../machines/BindMachineDialog'
import { logout } from './logout'
import './auth.css'

export const ROLE_LABEL: Record<UserDto['role'], string> = { sysadmin: '系统管理员', member: '普通成员' }

/** Avatar button + dropdown (Web 对话.dc.html ovMenu). */
export function AccountMenu() {
  const user = useSession((s) => s.user)
  const [open, setOpen] = useState(false)
  const [binding, setBinding] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!user) return null
  return (
    <div className="account">
      <button
        type="button"
        className="topbar__avatar"
        aria-label="账户菜单"
        aria-expanded={open}
        title={user.name}
        onClick={() => setOpen((v) => !v)}
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
