import type { AdminUserDto, UserDto } from '@aiws/protocol'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'
import {
  Alert,
  Avatar,
  Badge,
  type BadgeVariant,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  toast,
} from '../../ui'
import { ROLE_LABEL } from '../auth/AccountMenu'
import { errorText } from '../auth/AuthCard'
import { AdminPage } from './AdminPage'

const TITLE = '账号与角色'
const DESC = '系统管理员创建账号、分配角色；停用会吊销该成员所有 daemon 与会话。'
const ROLE_OPTIONS = (['member', 'sysadmin'] as const).map((value) => ({ value, label: ROLE_LABEL[value] }))

function status(u: AdminUserDto): [string, BadgeVariant] {
  if (u.disabled) return ['已停用', 'outline']
  if (!u.machineCount) return ['未绑定', 'secondary']
  return u.online ? ['在线', 'success'] : ['离线', 'secondary']
}

/** 管理后台 · 账号与角色 (sysadmin only). */
export function UsersPage() {
  // AdminLayout guarantees a sysadmin.
  const me = useSession((s) => s.user) as UserDto
  const [users, setUsers] = useState<AdminUserDto[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AdminUserDto | 'new' | null>(null)
  const [disabling, setDisabling] = useState<AdminUserDto | null>(null)

  const load = useCallback(async () => {
    try {
      setUsers(await api.get<AdminUserDto[]>('/admin/users'))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function enable(u: AdminUserDto) {
    try {
      await api.post(`/admin/users/${u.id}/enable`)
      toast({ type: 'success', message: `已启用 ${u.name}，需重新绑定机器` })
      void load()
    } catch (err) {
      toast({ type: 'error', message: errorText(err) })
    }
  }

  return (
    <AdminPage
      title={TITLE}
      desc={DESC}
      actions={
        <Button variant="primary" onClick={() => setEditing('new')}>
          新建账号
        </Button>
      }
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {users ? (
        <div className="admin-table">
          <table>
            <thead>
              <tr>
                <th>成员</th>
                <th>账号</th>
                <th>角色</th>
                <th>机器</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const [label, variant] = status(u)
                return (
                  <tr key={u.id}>
                    <td>
                      <span className="admin-table__member">
                        <Avatar name={u.name} size={24} />
                        <strong>{u.name}</strong>
                      </span>
                    </td>
                    <td className="admin-table__mono">{u.account}</td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td className="admin-table__muted">{u.disabled ? '—' : `${u.machineCount} 台`}</td>
                    <td>
                      <Badge variant={variant}>{label}</Badge>
                    </td>
                    <td className="admin-table__actions">
                      <Button variant="outline" size="xs" onClick={() => setEditing(u)}>
                        编辑
                      </Button>
                      {u.id === me.id ? null : u.disabled ? (
                        <Button variant="outline" size="xs" onClick={() => void enable(u)}>
                          启用
                        </Button>
                      ) : (
                        <Button variant="outline" size="xs" onClick={() => setDisabling(u)}>
                          停用
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : error ? null : (
        <Spinner size={18} />
      )}
      {disabling ? (
        <DisableDialog
          user={disabling}
          onClose={() => setDisabling(null)}
          onDone={() => {
            setDisabling(null)
            void load()
          }}
        />
      ) : null}
      {editing ? (
        <UserDialog
          user={editing === 'new' ? null : editing}
          self={editing !== 'new' && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      ) : null}
    </AdminPage>
  )
}

/** 管理后台.dc.html disableUser dialog (spec §9 账号停用). */
function DisableDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUserDto
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function disable() {
    setBusy(true)
    try {
      await api.post(`/admin/users/${user.id}/disable`)
      toast({ type: 'success', message: `已停用 ${user.name}` })
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={`停用账号 ${user.name}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void disable()}>
            停用
          </Button>
        </>
      }
    >
      <ul className="ui-consequences">
        <li>立即吊销其所有 daemon token 和 Web 会话</li>
        <li>daemon 下次连接失败后清除团队密钥和托管工作区（尽力而非保证）</li>
        <li>其 bot 从所有群移除；持锁中的 bot 按非主动中断处理</li>
        <li>群消息与审计记录保留</li>
      </ul>
      {error ? <Alert variant="error" description={error} /> : null}
    </Dialog>
  )
}

const ACCOUNT_RE = /^[a-z0-9_.-]{2,32}$/
const MIN_PASSWORD = 8

/** Create (user = null) or edit name/role. Title avoids the word 账号 so the 账号 field label stays unique. */
function UserDialog({
  user,
  self,
  onClose,
  onSaved,
}: {
  user: AdminUserDto | null
  self: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    account: '',
    name: user?.name ?? '',
    role: (user?.role ?? 'member') as UserDto['role'],
    password: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: 'account' | 'name' | 'password') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!user && !ACCOUNT_RE.test(form.account)) return setError('账号需为 2–32 位小写字母、数字或 . _ -')
    if (!form.name.trim()) return setError('请填写姓名')
    if (!user && form.password.length < MIN_PASSWORD) return setError(`初始密码至少 ${MIN_PASSWORD} 位`)
    setBusy(true)
    setError('')
    try {
      if (user) await api.patch(`/admin/users/${user.id}`, { name: form.name.trim(), role: form.role })
      else {
        await api.post('/admin/users', { ...form, name: form.name.trim() })
        toast({ type: 'success', message: `已创建账号 ${form.account}，首次登录需修改密码` })
      }
      onSaved()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={user ? `编辑成员 ${user.name}` : '新建成员'}
      subtitle={user ? user.account : '首次登录需修改初始密码'}
      onClose={onClose}
      width={420}
    >
      <form className="admin-form" onSubmit={submit} noValidate>
        {user ? null : (
          <Field label="账号">
            <Input mono value={form.account} onChange={set('account')} placeholder="wanglei" autoFocus />
          </Field>
        )}
        <Field label="姓名">
          <Input value={form.name} onChange={set('name')} placeholder="王磊" autoFocus={!!user} />
        </Field>
        <div className="ui-field">
          <span className="ui-field__label">角色</span>
          <Select
            label="角色"
            options={ROLE_OPTIONS}
            value={form.role}
            disabled={self}
            onChange={(role) => setForm((f) => ({ ...f, role }))}
          />
        </div>
        {user ? null : (
          <Field label="初始密码">
            <Input
              type="text"
              value={form.password}
              onChange={set('password')}
              placeholder={`至少 ${MIN_PASSWORD} 位`}
            />
          </Field>
        )}
        {error ? <Alert variant="error" description={error} /> : null}
        <div className="admin-form__actions">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {user ? '保存' : '创建'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
