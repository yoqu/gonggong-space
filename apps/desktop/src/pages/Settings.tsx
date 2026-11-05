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
import { PathValue } from '../lib/ui'
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
  const save = () => {
    try {
      const parsed = parseEnv(text)
      setError(null)
      void onSave(parsed)
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
          onClick={save}
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

  useEffect(() => {
    ipc.settings().then(setSettings, (e) => toast({ type: 'error', message: String(e) }))
  }, [])

  const toggle =
    (key: 'autoUpgrade' | 'launchAtLogin' | 'hideDockOnClose', save: (on: boolean) => Promise<void>) =>
    async (on: boolean) => {
      try {
        await save(on)
        setSettings((s) => s && { ...s, [key]: on })
      } catch (e) {
        toast({ type: 'error', message: String(e) })
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
      toast({ type: 'error', message: String(e) })
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
        <GroupRow label={t('自动升级')} description={t('自动下载新版本，重启后生效')}>
          <span className="dk-inline">
            <HelpButton help={t('服务器公布协议版本，不兼容时拒绝连接并提示升级。')} />
            <Switch
              aria-label={t('自动升级')}
              checked={settings?.autoUpgrade ?? false}
              disabled={!settings}
              onChange={toggle('autoUpgrade', ipc.setAutoUpgrade)}
            />
          </span>
        </GroupRow>
        <GroupRow label={t('开机启动')} description={t('登录系统后在后台运行')}>
          <Switch
            aria-label={t('开机启动')}
            checked={settings?.launchAtLogin ?? false}
            disabled={!settings}
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
        <GroupRow label={t('服务器')} description={t('只出站连接 · HTTPS / WSS')}>
          <span className="dk-value">{host(info?.server)}</span>
        </GroupRow>
      </GroupBox>
      <GroupBox>
        <GroupRow label={t('解除绑定…')} destructive onClick={() => setConfirming(true)} />
      </GroupBox>
      <p className="dk-footnote">{t('解除绑定后清除团队密钥与托管工作区，本机备份保留。')}</p>
      <AlertDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        icon={<img src={logo} alt="" width={48} height={48} />}
        title={t('要解除本机与团队服务器的绑定吗？')}
        message={t(
          '本机将断开连接，清除团队密钥与托管工作区（/cd 绑定的目录与本机备份保留），并回到首次绑定引导。此操作不可撤销。',
        )}
        actions={[
          { label: t('取消'), onClick: () => setConfirming(false) },
          { label: t('解除绑定'), variant: 'destructive', onClick: () => ipc.unbind() },
        ]}
      />
    </>
  )
}
