import type { Locale } from '@gonggong/protocol'
import { type GlassPreference, getGlass, setGlass } from '@web/app/glass'
import { MirrorRows } from '@web/features/machines/MirrorRows'
import { SaveStatus, useSaves } from '@web/features/machines/save'
import {
  AlertDialog,
  Button,
  GroupBox,
  GroupRow,
  HelpButton,
  SegmentedControl,
  Skeleton,
  Switch,
  TextField,
  toast,
} from '@web/ui'
import { useEffect, useState } from 'react'
import logo from '../assets/logo.svg'
import { locale, setLocale, t } from '../i18n'
import { ipc, type Mirror, type Settings } from '../ipc'
import { formatEnv, parseEnv } from '../lib/env'
import { host } from '../lib/labels'
import { fail, PathValue } from '../lib/ui'
import { ConnectionDiagnosticsDialog } from '../shell/ConnectionDiagnosticsDialog'
import { useRestartToUpdate } from '../shell/UpdateBanner'
import { useDaemon } from '../store'
import { getTheme, setTheme, type ThemePreference } from '../theme'
import { checkForUpdate, type UpdatePhase, useUpdate } from '../updater'
import type { PageProps } from '.'

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

const APPEARANCE: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: t('浅色') },
  { value: 'dark', label: t('深色') },
  { value: 'system', label: t('跟随系统') },
]

const GLASS: { value: GlassPreference; label: string }[] = [
  { value: 'clear', label: t('清透') },
  { value: 'standard', label: t('标准') },
  { value: 'tinted', label: t('着色') },
]

/** 环境变量 the agents start with, edited as `KEY=VALUE` lines. */
function EnvRows({
  env,
  onSave,
}: {
  env: Record<string, string>
  onSave: (e: Record<string, string>) => Promise<void>
}) {
  const [text, setText] = useState(() => formatEnv(env))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (saving) return
    try {
      const parsed = parseEnv(text)
      setError(null)
      setSaving(true)
      try {
        await onSave(parsed)
      } finally {
        setSaving(false)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <>
      <GroupRow
        label={t('环境变量')}
        description={t('启动 Agent 时附加，每行一个 KEY=VALUE；新启动的 Agent 进程生效')}
      >
        <TextField
          multiline
          rows={3}
          aria-label={t('环境变量')}
          style={{ width: 320 }}
          placeholder="KEY=VALUE"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </GroupRow>
      <div className="dk-row">
        <span className="dk-row__main">{error ? <span className="dk-danger">{error}</span> : null}</span>
        <Button
          variant="primary"
          aria-label={t('保存环境变量')}
          disabled={text === formatEnv(env)}
          loading={saving}
          onClick={() => void save()}
        >
          {t('保存')}
        </Button>
      </div>
    </>
  )
}

function updateLabel(s: UpdatePhase) {
  switch (s.phase) {
    case 'idle':
      return null
    case 'checking':
      return t('正在检查更新…')
    case 'latest':
      return t('已是最新版本')
    case 'downloading':
      return t('正在下载 v{v}…', { v: s.version })
    case 'ready':
      return t('v{v} 已下载，重启以更新', { v: s.version })
    case 'installing':
      return t('正在安装 v{v}…', { v: s.version })
    case 'error':
      return t('检查更新失败：{message}', { message: s.message })
  }
}

/** 版本: this app's version, the update status and 检查更新 / 立即重启. */
function VersionRow({ version }: { version: string | undefined }) {
  const state = useUpdate((s) => s.state)
  const restart = useRestartToUpdate()
  const busy = state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing'
  return (
    <GroupRow label={t('版本')} description={updateLabel(state) ?? undefined}>
      <span className="dk-inline">
        <span className="dk-value">{version ? `v${version}` : ''}</span>
        {state.phase === 'ready' ? (
          <Button variant="primary" onClick={restart.request}>
            {t('立即重启')}
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void checkForUpdate()}>
            {t('检查更新')}
          </Button>
        )}
      </span>
      {restart.dialog}
    </GroupRow>
  )
}

export function SettingsPage(_: PageProps) {
  const info = useDaemon((s) => s.info)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [theme, setThemeState] = useState<ThemePreference>(() => getTheme())
  const [glass, setGlassState] = useState<GlassPreference>(() => getGlass())
  const [confirming, setConfirming] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)
  const [savingToggles, setSavingToggles] = useState<Record<string, boolean>>({})

  useEffect(() => {
    ipc.settings().then(setSettings, fail)
  }, [])

  const toggle =
    (key: 'autoUpgrade' | 'launchAtLogin' | 'hideDockOnClose', save: (on: boolean) => Promise<void>) =>
    async (on: boolean) => {
      if (savingToggles[key]) return
      setSavingToggles((s) => ({ ...s, [key]: true }))
      try {
        await save(on)
        setSettings((s) => s && { ...s, [key]: on })
      } catch (e) {
        fail(e)
      } finally {
        setSavingToggles((s) => ({ ...s, [key]: false }))
      }
    }

  const closeUnbind = () => {
    if (!unbinding) setConfirming(false)
  }

  const confirmUnbind = async () => {
    if (unbinding) return
    setUnbinding(true)
    try {
      await ipc.unbind()
      setConfirming(false)
    } catch (e) {
      fail(e)
    } finally {
      setUnbinding(false)
    }
  }

  const saves = useSaves()
  const saveMirror = (mirror: Mirror) =>
    saves.save('mirror', async () => {
      await ipc.setMirror(mirror).catch((e) => {
        throw new Error(String(e))
      })
      setSettings((s) => s && { ...s, mirror })
      return undefined
    })

  const saveEnv = async (env: Record<string, string>) => {
    try {
      await ipc.setEnv(env)
      setSettings((s) => s && { ...s, env })
      toast({ type: 'success', message: t('环境变量已保存') })
    } catch (e) {
      fail(e)
    }
  }

  return (
    <>
      <GroupBox>
        <GroupRow label={t('语言')}>
          <SegmentedControl
            aria-label={t('语言')}
            items={LANGUAGES}
            value={locale}
            onChange={(v) => {
              if (v !== locale) setLocale(v)
            }}
          />
        </GroupRow>
        <GroupRow label={t('主题')}>
          <SegmentedControl
            aria-label={t('主题')}
            items={APPEARANCE}
            value={theme}
            onChange={(v) => {
              setTheme(v)
              setThemeState(v)
            }}
          />
        </GroupRow>
        <GroupRow label={t('玻璃效果')} description={t('调节侧栏、菜单和浮层的透明程度')}>
          <SegmentedControl
            aria-label={t('玻璃效果')}
            items={GLASS}
            value={glass}
            onChange={(v) => {
              setGlass(v)
              setGlassState(v)
            }}
          />
        </GroupRow>
      </GroupBox>
      <GroupBox>
        <VersionRow version={info?.version} />
        <GroupRow label={t('自动升级')} description={t('自动下载新版本，本机任务结束后自动重启生效')}>
          <span className="dk-inline">
            <HelpButton help={t('发现不兼容的旧版本时，会提示你升级后再连接。')} />
            <Switch
              aria-label={t('自动升级')}
              checked={settings?.autoUpgrade ?? false}
              disabled={!settings}
              loading={Boolean(savingToggles.autoUpgrade)}
              onChange={toggle('autoUpgrade', ipc.setAutoUpgrade)}
            />
          </span>
        </GroupRow>
        <GroupRow label={t('开机启动')} description={t('登录系统后在后台运行')}>
          <Switch
            aria-label={t('开机启动')}
            checked={settings?.launchAtLogin ?? false}
            disabled={!settings}
            loading={Boolean(savingToggles.launchAtLogin)}
            onChange={toggle('launchAtLogin', ipc.setLaunchAtLogin)}
          />
        </GroupRow>
        {info?.machine.os === 'macos' ? (
          <GroupRow
            label={t('关闭窗口后隐藏程序坞图标')}
            description={t('保留菜单栏图标，可从菜单栏重新打开；后台服务继续运行')}
          >
            <Switch
              aria-label={t('关闭窗口后隐藏程序坞图标')}
              checked={settings?.hideDockOnClose ?? false}
              disabled={!settings}
              loading={Boolean(savingToggles.hideDockOnClose)}
              onChange={toggle('hideDockOnClose', ipc.setHideDockOnClose)}
            />
          </GroupRow>
        ) : null}
      </GroupBox>
      <GroupBox>
        {settings ? (
          <MirrorRows
            key={JSON.stringify(settings.mirror)}
            mirror={settings.mirror}
            status={<SaveStatus state={saves.status('mirror')} />}
            onSave={saveMirror}
          />
        ) : (
          <GroupRow label={t('镜像源')}>
            <Skeleton count={1} width={160} />
          </GroupRow>
        )}
      </GroupBox>
      {settings ? (
        <GroupBox>
          <EnvRows env={settings.env} onSave={saveEnv} />
        </GroupBox>
      ) : null}
      <GroupBox>
        <GroupRow label={t('工作区根目录')} description={t('托管工作区与附件目录')}>
          {info ? <PathValue path={info.workspacesDir} /> : <Skeleton count={1} width={160} />}
        </GroupRow>
        <GroupRow label={t('备份目录')} description={t('被覆盖的本地修改、中断的半成品')}>
          {info ? <PathValue path={info.backupsDir} /> : <Skeleton count={1} width={160} />}
        </GroupRow>
        <GroupRow label={t('服务器')} description={t('由本机主动加密连接服务器')}>
          <span className="dk-value">{host(info?.server)}</span>
        </GroupRow>
        <GroupRow label={t('连接诊断')} onClick={() => setDiagOpen(true)} />
      </GroupBox>
      <GroupBox>
        <GroupRow label={t('解除绑定…')} destructive onClick={() => setConfirming(true)} />
      </GroupBox>
      <p className="dk-footnote">{t('解除绑定后清除团队密钥与托管工作区，本机备份保留。')}</p>
      <ConnectionDiagnosticsDialog open={diagOpen} onClose={() => setDiagOpen(false)} />
      <AlertDialog
        open={confirming}
        onClose={closeUnbind}
        icon={<img src={logo} alt="" width={48} height={48} />}
        title={t('要解除这台电脑与团队服务器的绑定吗？')}
        message={t(
          '这台电脑将断开连接，团队密钥和托管工作区会被清理，你手动选择的本机目录和本地备份会保留。此操作不可撤销。',
        )}
        actions={[
          { label: t('取消'), disabled: unbinding, onClick: closeUnbind },
          {
            label: t('解除绑定'),
            variant: 'destructive',
            disabled: unbinding,
            loading: unbinding,
            onClick: () => void confirmUnbind(),
          },
        ]}
      />
    </>
  )
}
