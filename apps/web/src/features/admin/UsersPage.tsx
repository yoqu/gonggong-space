import type { AdminUserDto, UserDto } from '@gonggong/protocol'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'
import {
  Alert,
  AlertDialog,
  Avatar,
  Button,
  Dialog,
  EmptyState,
  Input,
  PopUpButton,
  Presence,
  SearchField,
  Spinner,
  Tag,
  TextField,
  ToolbarButton,
  ToolbarGroup,
  toast,
} from '../../ui'
import { ROLE_LABEL } from '../auth/AccountMenu'
import { errorText } from '../auth/AuthCard'
import { AdminPage } from './AdminPage'

const TITLE = '账号与角色'
const DESC = '创建账号、分配角色、重置密码；停用会立即断开该成员的所有机器与登录。'
const ROLE_OPTIONS = (['member', 'sysadmin'] as const).map((value) => ({ value, label: ROLE_LABEL[value] }))

function Status({ user }: { user: AdminUserDto }) {
  if (user.disabled) return <Tag tone="gray">已停用</Tag>
  if (user.mustChangePassword) return <Tag tone="orange">待修改密码</Tag>
  return (
    <span className="admin-status admin-table__muted">
      <span className="admin-dot admin-dot--on" />
      正常
    </span>
  )
}

function machinesCell(u: AdminUserDto) {
  if (u.disabled) return '—'
  if (!u.machineCount) return '未绑定'
  return `${u.machineCount} 台 · ${u.online ? '在线' : '离线'}`
}

const READABLE = 'abcdefghjkmnpqrstuvwxyz23456789'
/** Readable temporary password (no 0/o/1/l/i), grouped for reading aloud: `k7qm-4x2p-9d`. */
export function tempPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  const chars = Array.from(bytes, (b) => READABLE[b % READABLE.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Temporary password field: generated on open and regenerable; it is copied only once it is actually in effect. */
function TempPasswordField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="admin-temp-pw">
        <Input
          id={id}
          mono
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`至少 ${MIN_PASSWORD} 位`}
        />
        <Button onClick={() => onChange(tempPassword())}>重新生成</Button>
      </span>
    </div>
  )
}

/** 管理后台 · 账号与角色 (sysadmin only). */
export function UsersPage() {
  // AdminLayout guarantees a sysadmin.
  const me = useSession((s) => s.user) as UserDto
  const [users, setUsers] = useState<AdminUserDto[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<AdminUserDto | 'new' | null>(null)
  const [disabling, setDisabling] = useState<AdminUserDto | null>(null)
  const [resetting, setResetting] = useState<AdminUserDto | null>(null)

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

  const q = query.trim().toLowerCase()
  const shown = users?.filter((u) => !q || `${u.name} ${u.account}`.toLowerCase().includes(q))

  return (
    <AdminPage
      title={TITLE}
      desc={DESC}
      subtitle={users ? `${users.length} 个账号` : undefined}
      actions={
        <ToolbarGroup>
          <ToolbarButton
            icon="person-add"
            label="新建账号"
            text="新建账号"
            onClick={() => setEditing('new')}
          />
        </ToolbarGroup>
      }
      search={<SearchField placeholder="搜索姓名或账号" value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {shown ? (
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
              {shown.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="admin-table__member">
                      <Avatar name={u.name} size={24} />
                      <strong>{u.name}</strong>
                    </span>
                  </td>
                  <td className="admin-table__mono">{u.account}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td className="admin-table__muted">{machinesCell(u)}</td>
                  <td>
                    <Status user={u} />
                  </td>
                  <td className="admin-table__actions">
                    <Button size="small" onClick={() => setEditing(u)}>
                      编辑
                    </Button>
                    {u.id === me.id || u.disabled ? null : (
                      <Button size="small" onClick={() => setResetting(u)}>
                        重置密码
                      </Button>
                    )}
                    {u.id === me.id ? null : u.disabled ? (
                      <Button size="small" onClick={() => void enable(u)}>
                        启用
                      </Button>
                    ) : (
                      <Button size="small" onClick={() => setDisabling(u)}>
                        停用
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users?.length === 1 ? (
            <EmptyState
              bare
              title="还没有其他成员"
              description="新建账号后，把账号和初始密码发给同事；对方首次登录时会被要求修改密码。"
              actions={
                <Button variant="primary" onClick={() => setEditing('new')}>
                  新建账号
                </Button>
              }
            />
          ) : shown.length ? null : (
            <EmptyState bare title="没有匹配的成员" />
          )}
        </div>
      ) : error ? null : (
        <Spinner size={18} />
      )}
      <Presence>
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
      </Presence>
      <Presence>
        {resetting ? (
          <ResetPasswordDialog
            user={resetting}
            onClose={() => setResetting(null)}
            onDone={() => {
              setResetting(null)
              void load()
            }}
          />
        ) : null}
      </Presence>
      <Presence>
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
      </Presence>
    </AdminPage>
  )
}

/** Confirms 停用 (spec §9 账号停用) with its consequences. */
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
    <AlertDialog
      open
      title={`要停用账号 ${user.name} 吗？`}
      message="可以随时重新启用，但需要重新绑定机器。"
      detail={
        <>
          <ul className="ui-consequences">
            <li>立即吊销其所有 daemon token 和 Web 会话</li>
            <li>daemon 下次连接失败后清除团队密钥和托管工作区（尽力而非保证）</li>
            <li>其 Bot 从所有群移除；持锁中的 Bot 按非主动中断处理</li>
            <li>群消息与审计记录保留</li>
          </ul>
          {error ? <Alert variant="error" description={error} /> : null}
        </>
      }
      onClose={onClose}
      actions={[
        { label: '取消', onClick: onClose },
        { label: '停用', variant: 'destructive', disabled: busy, onClick: () => void disable() },
      ]}
    />
  )
}

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUserDto
  onClose: () => void
  onDone: () => void
}) {
  const [password, setPassword] = useState(tempPassword)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function reset() {
    if (password.length < MIN_PASSWORD) return setError(`临时密码至少 ${MIN_PASSWORD} 位`)
    setBusy(true)
    try {
      await api.post(`/admin/users/${user.id}/password`, { password })
      const copied = await copy(password)
      toast({
        type: 'success',
        message: copied
          ? `已重置，临时密码已复制，请私下发给 ${user.name}`
          : `已重置 ${user.name} 的密码，请记下临时密码 ${password}`,
      })
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={`重置 ${user.name} 的密码`}
      subtitle={user.account}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={busy} onClick={() => void reset()}>
            重置并复制
          </Button>
        </>
      }
    >
      <div className="admin-form">
        <TempPasswordField label="临时密码" value={password} onChange={setPassword} />
        <Alert
          variant="warning"
          title="重置后立即生效"
          description="对方所有网页登录立即失效，需用临时密码重新登录并马上修改；已绑定的机器与 Bot 不受影响。"
        />
        {error ? <Alert variant="error" description={error} /> : null}
      </div>
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
    password: user ? '' : tempPassword(),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formId = useId()
  const set = (k: 'account' | 'name') => (e: { target: { value: string } }) =>
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
        const copied = await copy(`账号 ${form.account}  初始密码 ${form.password}`)
        toast({
          type: 'success',
          message: `已创建账号 ${form.account}${copied ? '，账号和初始密码已复制' : ''}，首次登录需修改密码`,
        })
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
      closeOnBackdrop={false}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            {user ? '保存' : '创建'}
          </Button>
        </>
      }
    >
      <form id={formId} className="admin-form" onSubmit={submit} noValidate>
        {user ? null : (
          <TextField
            label="账号"
            mono
            value={form.account}
            onChange={set('account')}
            placeholder="wanglei"
            autoFocus
          />
        )}
        <TextField
          label="姓名"
          value={form.name}
          onChange={set('name')}
          placeholder="王磊"
          autoFocus={!!user}
        />
        <div className="ui-field">
          <span className="ui-field__label">角色</span>
          <PopUpButton
            aria-label="角色"
            options={ROLE_OPTIONS}
            value={form.role}
            disabled={self}
            onChange={(role) => setForm((f) => ({ ...f, role }))}
          />
        </div>
        {user ? null : (
          <TempPasswordField
            label="初始密码"
            value={form.password}
            onChange={(password) => setForm((f) => ({ ...f, password }))}
          />
        )}
        {error ? <Alert variant="error" description={error} /> : null}
      </form>
    </Dialog>
  )
}
