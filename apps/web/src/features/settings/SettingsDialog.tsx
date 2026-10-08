import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  type FeishuIdentityView,
  type GitAccountDto,
  type GitProvider,
  type Locale,
  type UserDto,
} from '@gonggong/protocol'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type GlassPreference, getGlass, setGlass } from '../../app/glass'
import { useSession } from '../../app/session'
import { getTheme, setTheme, type ThemePreference } from '../../app/theme'
import { locale, setLocale, t } from '../../i18n'
import { ApiError, api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Avatar,
  Button,
  Dialog,
  GroupBox,
  GroupRow,
  Icon,
  type IconName,
  PopUpButton,
  Presence,
  SecureField,
  SegmentedControl,
  Sheet,
  Spinner,
  TextField,
} from '../../ui'
import { ChangePasswordDialog } from '../auth/ChangePasswordPage'
import { FeishuIdentityRow } from '../feishu/FeishuIdentityRow'
import '../groups/groups.css'
import { accountLabel, gitAccountsApi, useGitAccounts } from './api'
import { type SettingsPage, useSettings } from './store'
import './settings.css'

const PAGES: { value: SettingsPage; label: string; icon: IconName }[] = [
  { value: 'appearance', label: t('外观'), icon: 'appearance' },
  { value: 'git', label: t('Git 与仓库'), icon: 'git-branch' },
  { value: 'account', label: t('账户'), icon: 'person' },
]

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: t('浅色') },
  { value: 'dark', label: t('深色') },
  { value: 'system', label: t('跟随系统') },
]

const GLASS_OPTIONS: { value: GlassPreference; label: string }[] = [
  { value: 'clear', label: t('清透') },
  { value: 'standard', label: t('标准') },
  { value: 'tinted', label: t('着色') },
]

/** Tried first when my bots clone or check a repo; the other protocol is the fallback. */
const GIT_OPTIONS: { value: UserDto['gitProtocol']; label: string }[] = [
  { value: 'auto', label: t('按仓库地址') },
  { value: 'ssh', label: t('优先 SSH') },
  { value: 'https', label: t('优先 HTTPS') },
]

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

/** Mounted once in the shell; `useSettings().open(page)` shows it. */
export function SettingsHost() {
  const page = useSettings((s) => s.page)
  const close = useSettings((s) => s.close)
  return <Presence>{page ? <SettingsDialog page={page} onClose={close} /> : null}</Presence>
}

function SettingsDialog({ page: initial, onClose }: { page: SettingsPage; onClose: () => void }) {
  const [page, setPage] = useState(initial)
  useEffect(() => setPage(initial), [initial])
  return (
    <Dialog open width={720} title={PAGES.find((p) => p.value === page)?.label} onClose={onClose}>
      <div className="gs-settings">
        <nav className="gs-settings__nav">
          <span className="gs-settings__heading">{t('设置')}</span>
          {PAGES.map((p) => (
            <button
              key={p.value}
              type="button"
              className={cx('gs-settings__tab', p.value === page && 'gs-settings__tab--on')}
              aria-current={p.value === page ? 'page' : undefined}
              onClick={() => setPage(p.value)}
            >
              <Icon name={p.icon} size={15} />
              {p.label}
            </button>
          ))}
        </nav>
        <div className="gs-settings__body">
          {page === 'appearance' ? <AppearancePage /> : page === 'git' ? <GitPage /> : <AccountPage />}
        </div>
      </div>
    </Dialog>
  )
}

function AppearancePage() {
  const [theme, setThemeState] = useState(getTheme)
  const [glass, setGlassState] = useState(getGlass)
  return (
    <GroupBox>
      <GroupRow label={t('语言')}>
        <SegmentedControl
          aria-label={t('语言')}
          items={LOCALE_OPTIONS}
          value={locale}
          onChange={(v) => {
            if (v !== locale) setLocale(v)
          }}
        />
      </GroupRow>
      <GroupRow label={t('主题')}>
        <SegmentedControl
          aria-label={t('主题')}
          items={THEME_OPTIONS}
          value={theme}
          onChange={(v) => {
            setTheme(v)
            setThemeState(v)
          }}
        />
      </GroupRow>
      <GroupRow label={t('玻璃效果')}>
        <SegmentedControl
          aria-label={t('玻璃效果')}
          items={GLASS_OPTIONS}
          value={glass}
          onChange={(v) => {
            setGlass(v)
            setGlassState(v)
          }}
        />
      </GroupRow>
    </GroupBox>
  )
}

function GitPage() {
  const user = useSession((s) => s.user)
  const { accounts, load, set } = useGitAccounts()
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    load().catch(toastError)
  }, [load])
  if (!user) return null

  const disconnect = async (a: GitAccountDto) => {
    try {
      await gitAccountsApi.remove(a.id)
      set((accounts ?? []).filter((x) => x.id !== a.id))
    } catch (e) {
      toastError(e)
    }
  }
  const setProtocol = (gitProtocol: UserDto['gitProtocol']) =>
    api
      .patch<UserDto>('/me', { gitProtocol })
      .then((u) => useSession.getState().setUser(u))
      .catch(toastError)

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section__title">{t('已连接的账号')}</h3>
        <GroupBox>
          {accounts === null ? (
            <GroupRow label={<Spinner />} />
          ) : (
            accounts.map((a) => (
              <GroupRow
                key={a.id}
                label={
                  <span className="settings-account">
                    <Icon name={a.provider} />
                    <span>{accountLabel(a)}</span>
                    <span className="settings-account__login">{a.login}</span>
                  </span>
                }
                description={a.baseUrl === 'https://github.com' ? undefined : a.baseUrl}
              >
                <span className="gs-value-line">
                  {a.status === 'invalid' ? (
                    <span className="settings-account__bad">{t('需要重新连接')}</span>
                  ) : null}
                  <Button size="small" onClick={() => void disconnect(a)}>
                    {t('断开')}
                  </Button>
                </span>
              </GroupRow>
            ))
          )}
          <GroupRow label={t('添加账号…')} onClick={() => setAdding(true)} />
        </GroupBox>
      </section>
      <section className="settings-section">
        <h3 className="settings-section__title">{t('克隆')}</h3>
        <GroupBox>
          <GroupRow label={t('协议偏好')} description={t('我的 Bot 克隆或检查仓库时优先尝试的协议')}>
            <PopUpButton
              aria-label={t('协议偏好')}
              options={GIT_OPTIONS}
              value={user.gitProtocol}
              onChange={(v) => void setProtocol(v)}
            />
          </GroupRow>
        </GroupBox>
      </section>
      <AddAccountSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(a) => {
          set([...(accounts ?? []).filter((x) => x.id !== a.id), a])
          setAdding(false)
        }}
      />
    </>
  )
}

const TOKEN_NAME = t('共工空间')
const TOKEN_NOTE = t('共工空间：列出我的仓库和分支（只读）')

/** Creation page with the name and read-only permission prefilled; unknown parameters are ignored by older instances. */
export function tokenUrl(provider: GitProvider, base: string) {
  const q =
    provider === 'github'
      ? new URLSearchParams({ name: TOKEN_NAME, description: TOKEN_NOTE, expires_in: '90', contents: 'read' })
      : new URLSearchParams({ name: TOKEN_NAME, description: TOKEN_NOTE, scopes: 'read_api' })
  const path =
    provider === 'github' ? '/settings/personal-access-tokens/new' : '/-/user_settings/personal_access_tokens'
  return `${base}${path}?${q}`
}

const TOKEN_STEPS: Record<GitProvider, { prefilled: string; steps: string[] }> = {
  github: {
    prefilled: t('名称、90 天有效期、Contents 只读'),
    steps: [
      t('Repository access 选「All repositories」；要列出组织仓库，Resource owner 选对应组织'),
      t('点「Generate token」，复制以 github_pat_ 开头的 Token，粘贴到下方'),
    ],
  },
  gitlab: {
    prefilled: t('名称、read_api 权限'),
    steps: [t('按需设置过期时间，点「Create token」'), t('复制以 glpat- 开头的 Token，粘贴到下方')],
  },
}

const LABEL: Record<GitProvider, string> = { github: 'GitHub', gitlab: 'GitLab' }

/** Step-by-step help with a one-click link to the prefilled token page. */
function TokenGuide({ provider, base }: { provider: GitProvider; base: string }) {
  const guide = TOKEN_STEPS[provider]
  const ready = /^https?:\/\/[^/\s]+/.test(base)
  return (
    <section className="settings-guide" aria-label={t('如何获取 Token')}>
      <h4 className="settings-guide__title">{t('如何获取 Token')}</h4>
      <ol className="settings-guide__steps">
        <li>
          <span>{t('打开已预填（{fields}）的创建页', { fields: guide.prefilled })}</span>
          <Button
            size="small"
            icon={provider}
            disabled={!ready}
            title={ready ? undefined : t('先填写实例地址')}
            onClick={() => window.open(tokenUrl(provider, base), '_blank', 'noopener')}
          >
            {t('在 {provider} 创建 Token', { provider: LABEL[provider] })}
          </Button>
        </li>
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="settings-guide__note">
        {t('Token 只用于列出仓库和分支，加密保存在服务器，不用于 clone。')}
      </p>
    </section>
  )
}

function AddAccountSheet({
  open,
  onClose,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded: (a: GitAccountDto) => void
}) {
  const [provider, setProvider] = useState<GitProvider>('github')
  const [baseUrl, setBaseUrl] = useState('https://github.com')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setProvider('github')
    setBaseUrl('https://github.com')
    setToken('')
    setError('')
  }, [open])

  const base = baseUrl.trim().replace(/\/+$/, '')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !base || !token.trim()) return
    setBusy(true)
    setError('')
    try {
      onAdded(await gitAccountsApi.add({ provider, baseUrl: base, token: token.trim() }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('连接失败，请重试'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('添加 Git 账号')}
      width={420}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: busy ? t('验证中…') : t('连接'),
          variant: 'primary',
          type: 'submit',
          form: 'add-git-account',
          disabled: busy || !base || !token.trim(),
        },
      ]}
    >
      <form id="add-git-account" className="settings-add" onSubmit={submit} noValidate>
        <SegmentedControl
          aria-label={t('类型')}
          items={[
            { value: 'github', label: 'GitHub', icon: 'github' },
            { value: 'gitlab', label: 'GitLab', icon: 'gitlab' },
          ]}
          value={provider}
          onChange={(v) => {
            setProvider(v)
            setBaseUrl(v === 'github' ? 'https://github.com' : '')
            setError('')
          }}
        />
        <TextField
          label={t('实例地址')}
          value={baseUrl}
          placeholder={provider === 'gitlab' ? 'https://gitlab.example.com' : undefined}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <TokenGuide provider={provider} base={base} />
        <SecureField
          label="Token"
          autoComplete="off"
          placeholder={provider === 'github' ? 'github_pat_…' : 'glpat-…'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {error ? <Alert variant="error" description={error} /> : null}
      </form>
    </Sheet>
  )
}

function AccountPage() {
  const user = useSession((s) => s.user)
  const [changing, setChanging] = useState(false)
  const [editing, setEditing] = useState<ProfileField | null>(null)
  return (
    <>
      <GroupBox>
        <AvatarRow />
        <GroupRow label={t('显示名')}>
          <span className="gs-value-line">
            {user?.name}
            <Button size="small" onClick={() => setEditing('name')}>
              {t('修改显示名…')}
            </Button>
          </span>
        </GroupRow>
        <GroupRow label={t('邮箱')}>
          <span className="gs-value-line">
            {user?.email ?? <span className="settings-account__login">{t('未设置')}</span>}
            <Button size="small" onClick={() => setEditing('email')}>
              {t('修改邮箱…')}
            </Button>
          </span>
        </GroupRow>
        <GroupRow label={t('密码')}>
          <Button size="small" onClick={() => setChanging(true)}>
            {t('修改密码…')}
          </Button>
        </GroupRow>
        <FeishuIdentityRow />
      </GroupBox>
      <Presence>{changing ? <ChangePasswordDialog onClose={() => setChanging(false)} /> : null}</Presence>
      <ProfileSheet
        field={editing ?? 'name'}
        open={editing !== null}
        current={(editing && user?.[editing]) ?? ''}
        onClose={() => setEditing(null)}
      />
    </>
  )
}

/** Upload a picture, take the linked Feishu avatar, or fall back to the generated one. */
function AvatarRow() {
  const user = useSession((s) => s.user)
  const { data: feishu } = useGet<FeishuIdentityView>('/me/feishu')
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const run = async (call: () => Promise<UserDto>) => {
    setBusy(true)
    try {
      useSession.getState().setUser(await call())
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!file) return
    if (!(AVATAR_TYPES as readonly string[]).includes(file.type))
      return toastError(new Error(t('头像仅支持 PNG、JPEG、WebP 或 GIF 图片')))
    if (file.size > AVATAR_MAX_BYTES) return toastError(new Error(t('头像不能超过 {maxMb} MB', { maxMb: 2 })))
    const form = new FormData()
    form.append('file', file)
    void run(() => api.put<UserDto>('/me/avatar', form))
  }
  const feishuAvatar = feishu?.identity?.avatar
  return (
    <GroupRow label={t('头像')}>
      <span className="gs-value-line">
        <Avatar name={user.name} src={user.avatar ?? undefined} size={40} />
        <input
          ref={input}
          type="file"
          accept={AVATAR_TYPES.join(',')}
          hidden
          aria-label={t('上传头像')}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Button size="small" disabled={busy} onClick={() => input.current?.click()}>
          {t('上传头像…')}
        </Button>
        {feishuAvatar && feishuAvatar !== user.avatar ? (
          <Button
            size="small"
            disabled={busy}
            onClick={() => run(() => api.post<UserDto>('/me/avatar/feishu'))}
          >
            {t('使用飞书头像')}
          </Button>
        ) : null}
        {user.avatar ? (
          <Button size="small" disabled={busy} onClick={() => run(() => api.del<UserDto>('/me/avatar'))}>
            {t('移除头像')}
          </Button>
        ) : null}
      </span>
    </GroupRow>
  )
}

type ProfileField = 'name' | 'email'

const PROFILE_SHEET: Record<ProfileField, { title: string; label: string; hint: string; max: number }> = {
  name: { title: t('修改显示名'), label: t('显示名'), hint: t('在群成员与消息里显示'), max: 40 },
  email: { title: t('修改邮箱'), label: t('邮箱'), hint: t('留空即清除'), max: 120 },
}

function ProfileSheet({
  field,
  open,
  current,
  onClose,
}: {
  field: ProfileField
  open: boolean
  current: string
  onClose: () => void
}) {
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setValue(current)
    setError('')
  }, [open, current])

  const spec = PROFILE_SHEET[field]
  const next = value.trim()
  const disabled = busy || (field === 'name' && !next) || next === current
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (disabled) return
    setBusy(true)
    setError('')
    try {
      useSession.getState().setUser(await api.patch<UserDto>('/me', { [field]: next }))
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('保存失败，请重试'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={spec.title}
      width={420}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('保存'), variant: 'primary', type: 'submit', form: 'edit-me', disabled },
      ]}
    >
      <form id="edit-me" className="settings-add" onSubmit={submit} noValidate>
        <TextField
          label={spec.label}
          type={field === 'email' ? 'email' : 'text'}
          value={value}
          maxLength={spec.max}
          hint={spec.hint}
          onChange={(e) => setValue(e.target.value)}
        />
        {error ? <Alert variant="error" description={error} /> : null}
      </form>
    </Sheet>
  )
}
