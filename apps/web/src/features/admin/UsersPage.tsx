import type { AdminUserDto, UserDto } from '@gonggong/protocol'
import { useId, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Avatar,
  Button,
  ConfirmActionDialog,
  Dialog,
  EmptyState,
  Form,
  FormRow,
  NoMembersArt,
  NoResultsArt,
  PopUpButton,
  Presence,
  SearchField,
  Spinner,
  Table,
  Tag,
  TextField,
  ToolbarButton,
  ToolbarGroup,
  toast,
} from '../../ui'
import { ROLE_LABEL } from '../auth/AccountMenu'
import { AdminPage } from './AdminPage'

const TITLE = t('账号与角色')
const DESC = t('创建账号、分配角色、重置密码；停用会立即断开该成员的所有机器与登录。')
const ROLE_OPTIONS = (['member', 'sysadmin'] as const).map((value) => ({ value, label: ROLE_LABEL[value] }))

function Status({ user }: { user: AdminUserDto }) {
  if (user.disabled) return <Tag tone="gray">{t('已停用')}</Tag>
  if (user.mustChangePassword) return <Tag tone="orange">{t('待修改密码')}</Tag>
  return (
    <span className="admin-status">
      <span className="admin-dot admin-dot--on" />
      {t('正常')}
    </span>
  )
}

function machinesCell(u: AdminUserDto) {
  if (u.disabled) return null
  if (!u.machineCount) return t('未绑定')
  return t('{n} 台 · {state}', { n: u.machineCount, state: u.online ? t('在线') : t('离线') })
}

const STATUS_ORDER = (u: AdminUserDto) => (u.disabled ? 2 : u.mustChangePassword ? 1 : 0)

const READABLE = 'abcdefghjkmnpqrstuvwxyz23456789'
/** Readable temporary password (no 0/o/1/l/i), grouped for reading aloud: `k7qm-4x2p-9d`. */
export function tempPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  const chars = Array.from(bytes, (b) => READABLE[b % READABLE.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`
}

const copy = (text: string) =>
  copyText(text).then(
    () => true,
    () => false,
  )

/** Temporary password: generated on open and regenerable; it is copied only once it is actually in effect. */
function TempPasswordField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <span className="admin-temp-pw">
      <TextField
        aria-label={label}
        mono
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('至少 {n} 位', { n: MIN_PASSWORD })}
      />
      <Button onClick={() => onChange(tempPassword())}>{t('重新生成')}</Button>
    </span>
  )
}

/** 管理后台 · 账号与角色 (sysadmin only). */
export function UsersPage() {
  // AdminLayout guarantees a sysadmin.
  const me = useSession((s) => s.user) as UserDto
  const { data: users, error, reload: load } = useGet<AdminUserDto[]>('/admin/users')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<AdminUserDto | 'new' | null>(null)
  const [disabling, setDisabling] = useState<AdminUserDto | null>(null)
  const [resetting, setResetting] = useState<AdminUserDto | null>(null)

  async function enable(u: AdminUserDto) {
    try {
      await api.post(`/admin/users/${u.id}/enable`)
      toast({ type: 'success', message: t('已启用 {name}，需重新绑定机器', { name: u.name }) })
      void load()
    } catch (err) {
      toastError(err)
    }
  }

  const q = query.trim().toLowerCase()
  const shown = users?.filter((u) => !q || `${u.name} ${u.account}`.toLowerCase().includes(q))

  return (
    <AdminPage
      title={TITLE}
      desc={DESC}
      subtitle={users ? t('{n} 个账号', { n: users.length }) : undefined}
      actions={
        <ToolbarGroup>
          <ToolbarButton
            icon="person-add"
            label={t('新建账号…')}
            text={t('新建账号…')}
            onClick={() => setEditing('new')}
          />
        </ToolbarGroup>
      }
      search={<SearchField placeholder={t('搜索姓名或账号')} value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {shown ? (
        <Table<AdminUserDto>
          aria-label={t('账号列表')}
          className="admin-grid"
          rows={shown}
          multiple={false}
          defaultSort={{ key: 'name', dir: 'asc' }}
          onOpen={setEditing}
          rowActions={(u) => [
            { label: t('编辑…'), value: 'edit' },
            ...(u.id === me.id
              ? []
              : u.disabled
                ? [{ label: t('启用'), value: 'enable' }]
                : [
                    { label: t('重置密码…'), value: 'reset' },
                    { separator: true as const },
                    { label: t('停用…'), value: 'disable', destructive: true },
                  ]),
          ]}
          onRowAction={(action, u) => {
            if (action === 'edit') setEditing(u)
            else if (action === 'reset') setResetting(u)
            else if (action === 'disable') setDisabling(u)
            else void enable(u)
          }}
          emptyText={
            <EmptyState
              compact
              title={q ? t('没有匹配的成员') : t('还没有账号')}
              illustration={q ? <NoResultsArt /> : <NoMembersArt />}
            />
          }
          columns={[
            {
              key: 'name',
              title: t('成员'),
              sortable: true,
              render: (u) => (
                <>
                  <Avatar name={u.name} src={u.avatar ?? undefined} size={18} />
                  {u.name}
                </>
              ),
            },
            { key: 'account', title: t('账号'), sortable: true, mono: true, secondary: true },
            {
              key: 'teams',
              title: t('所属团队'),
              secondary: true,
              sortable: true,
              sortValue: (u) => u.teams.join(t('、')),
              render: (u) => u.teams.join(t('、')) || '--',
            },
            {
              key: 'role',
              title: t('角色'),
              width: 108,
              sortable: true,
              sortValue: (u) => ROLE_LABEL[u.role],
              render: (u) => ROLE_LABEL[u.role],
            },
            {
              key: 'machines',
              title: t('机器#count'),
              width: 120,
              secondary: true,
              sortable: true,
              sortValue: (u) => (u.disabled ? -1 : u.machineCount),
              render: machinesCell,
            },
            {
              key: 'status',
              title: t('状态'),
              width: 104,
              sortable: true,
              sortValue: STATUS_ORDER,
              render: (u) => <Status user={u} />,
            },
          ]}
        />
      ) : error ? null : (
        <Spinner size={18} />
      )}
      {users?.length === 1 ? (
        <EmptyState
          compact
          illustration={<NoMembersArt />}
          title={t('还没有其他成员')}
          description={t('新建账号后，把账号和初始密码发给同事；对方首次登录时会被要求修改密码。')}
          action={
            <Button variant="primary" onClick={() => setEditing('new')}>
              {t('新建账号…')}
            </Button>
          }
        />
      ) : null}
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
  return (
    <ConfirmActionDialog
      title={t('要停用账号 {name} 吗？', { name: user.name })}
      message={t('可以随时重新启用，但需要重新绑定机器。')}
      consequences={[
        t('立即吊销其所有 daemon token 和 Web 会话'),
        t('daemon 下次连接失败后清除团队密钥和托管工作区（尽力而非保证）'),
        t('其 Bot 从所有群移除；运行中的 Bot 按非主动中断处理'),
        t('群消息与审计记录保留'),
      ]}
      label={t('停用')}
      done={t('已停用 {name}', { name: user.name })}
      run={() => api.post(`/admin/users/${user.id}/disable`)}
      onDone={onDone}
      onClose={onClose}
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
  const formId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function reset() {
    if (password.length < MIN_PASSWORD) return setError(t('临时密码至少 {n} 位', { n: MIN_PASSWORD }))
    setBusy(true)
    try {
      await api.post(`/admin/users/${user.id}/password`, { password })
      const copied = await copy(password)
      toast({
        type: 'success',
        message: copied
          ? t('已重置，临时密码已复制，请私下发给 {name}', { name: user.name })
          : t('已重置 {name} 的密码，请记下临时密码 {password}', { name: user.name, password }),
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
      title={t('重置 {name} 的密码', { name: user.name })}
      message={t('对方所有网页登录立即失效，需用临时密码重新登录并马上修改；已绑定的机器与 Bot 不受影响。')}
      onClose={onClose}
      closeOnBackdrop={false}
      width={480}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('重置并复制'), variant: 'primary', type: 'submit', form: formId, disabled: busy },
      ]}
    >
      <Form id={formId} onSubmit={() => void reset()}>
        <FormRow label={t('账号')}>
          <span className="admin-form__static">{user.account}</span>
        </FormRow>
        <FormRow label={t('临时密码')} hint={t('重置后自动复制，请私下发给对方。')}>
          <TempPasswordField label={t('临时密码')} value={password} onChange={setPassword} />
        </FormRow>
      </Form>
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
    password: user ? '' : tempPassword(),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formId = useId()
  const set = (k: 'account' | 'name') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    if (!user && !ACCOUNT_RE.test(form.account)) return setError(t('账号需为 2–32 位小写字母、数字或 . _ -'))
    if (!form.name.trim()) return setError(t('请填写姓名'))
    if (!user && form.password.length < MIN_PASSWORD)
      return setError(t('初始密码至少 {n} 位', { n: MIN_PASSWORD }))
    setBusy(true)
    setError('')
    try {
      if (user) await api.patch(`/admin/users/${user.id}`, { name: form.name.trim(), role: form.role })
      else {
        await api.post('/admin/users', { ...form, name: form.name.trim() })
        const copied = await copy(
          t('账号 {account}  初始密码 {password}', { account: form.account, password: form.password }),
        )
        toast({
          type: 'success',
          message: copied
            ? t('已创建账号 {account}，账号和初始密码已复制，首次登录需修改密码', { account: form.account })
            : t('已创建账号 {account}，首次登录需修改密码', { account: form.account }),
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
      title={user ? t('编辑成员 {name}', { name: user.name }) : t('新建成员')}
      subtitle={user ? undefined : t('首次登录需修改初始密码')}
      onClose={onClose}
      closeOnBackdrop={false}
      width={460}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: user ? t('保存') : t('创建'),
          variant: 'primary',
          type: 'submit',
          form: formId,
          disabled: busy,
        },
      ]}
    >
      <Form id={formId} onSubmit={submit}>
        <FormRow
          label={t('账号')}
          hint={user ? undefined : t('2–32 位小写字母、数字或 . _ -，创建后不能修改')}
        >
          {user ? (
            <span className="admin-form__static">{user.account}</span>
          ) : (
            <TextField
              aria-label={t('账号')}
              mono
              value={form.account}
              onChange={set('account')}
              placeholder="wanglei"
              autoFocus
            />
          )}
        </FormRow>
        <FormRow label={t('姓名')}>
          <TextField
            aria-label={t('姓名')}
            value={form.name}
            onChange={set('name')}
            placeholder={t('王磊')}
            autoFocus={!!user}
          />
        </FormRow>
        <FormRow label={t('角色')} hint={self ? t('不能修改自己的角色') : undefined}>
          <PopUpButton
            aria-label={t('角色')}
            options={ROLE_OPTIONS}
            value={form.role}
            disabled={self}
            onChange={(role) => setForm((f) => ({ ...f, role }))}
          />
        </FormRow>
        {user ? null : (
          <FormRow label={t('初始密码')} hint={t('创建后账号与初始密码会一起复制。')}>
            <TempPasswordField
              label={t('初始密码')}
              value={form.password}
              onChange={(password) => setForm((f) => ({ ...f, password }))}
            />
          </FormRow>
        )}
      </Form>
      {error ? <Alert variant="error" description={error} /> : null}
    </Dialog>
  )
}
