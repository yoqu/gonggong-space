import type { Locale } from '@gonggong/protocol'
import { type GlassPreference, getGlass, setGlass } from '@web/app/glass'
import { MirrorRows } from '@web/features/machines/MirrorRows'
import { SaveStatus, useSaves } from '@web/features/machines/save'
import {
  Alert,
  Button,
  GroupBox,
  GroupRow,
  HelpButton,
  SegmentedControl,
  Skeleton,
  Switch,
  TextField,
} from '@web/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { locale, setLocale, t } from '../i18n'
import { ipc, type Mirror, type Settings } from '../ipc'
import { formatEnv, parseEnv } from '../lib/env'
import { host } from '../lib/labels'
import { fail, PathValue } from '../lib/ui'
import { useUnbind } from '../lib/unbind'
import { useIpc } from '../lib/useIpc'
import { ConnectionDiagnosticsDialog } from '../shell/ConnectionDiagnosticsDialog'
import { UpdateAction } from '../shell/UpdateBanner'
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

/**
 * 环境变量 the agents start with, edited as `KEY=VALUE` lines and saved like 镜像源 on blur and when leaving the page,
 * never while typing (a half-typed `KEY=` would reach the agents). Emptying a non-empty list is confirmed on blur and
 * not saved when leaving.
 */
function EnvRows({
  env,
  status,
  onSave,
  onRefuse,
  onAccept,
}: {
  env: Record<string, string>
  status: ReactNode
  onSave: (e: Record<string, string>) => Promise<boolean>
  onRefuse: (error: string) => void
  onAccept: () => void
}) {
  const [text, setText] = useState(() => formatEnv(env))
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const saved = useRef<Record<string, string>>(env)
  const sent = useRef(JSON.stringify(env))
  const inflight = useRef<string | null>(null)
  const queued = useRef<{ key: string; value: Record<string, string> } | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const latest = useRef(text)
  const flush = (key: string, parsed: Record<string, string>) => {
    inflight.current = key
    void onSaveRef
      .current(parsed)
      .then((ok) => {
        if (ok) {
          saved.current = parsed
          sent.current = key
        }
      })
      .catch(() => {})
      .finally(() => {
        if (inflight.current === key) inflight.current = null
        const next = queued.current
        queued.current = null
        if (next && next.key !== sent.current) flush(next.key, next.value)
      })
  }
  const send = (parsed: Record<string, string>) => {
    const key = JSON.stringify(parsed)
    const effective = queued.current?.key ?? inflight.current ?? sent.current
    if (key === effective) return
    if (inflight.current !== null) {
      queued.current = key === inflight.current ? null : { key, value: parsed }
      return
    }
    flush(key, parsed)
  }
  const commit = (value: string, leaving: boolean) => {
    let parsed: Record<string, string>
    try {
      parsed = parseEnv(value)
    } catch (e) {
      if (!leaving) onRefuse((e as Error).message)
      return
    }
    onAccept()
    const effective = queued.current?.key ?? inflight.current ?? sent.current
    if (Object.keys(parsed).length === 0 && effective !== '{}') {
      if (!leaving) setConfirmEmpty(true)
      return
    }
    send(parsed)
  }
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => () => commitRef.current(latest.current, true), [])
  const dirty = confirmEmpty || text !== formatEnv(saved.current)
  return (
    <GroupRow
      label={t('环境变量')}
      description={t('启动 Agent 时附加，每行一个 KEY=VALUE；新启动的 Agent 进程生效')}
    >
      <span className="dk-inline" data-dirty={dirty ? 'true' : undefined}>
        {confirmEmpty ? (
          <>
            <span className="dk-sub">{t('环境变量已清空，确认保存？')}</span>
            <Button
              size="small"
              onClick={() => {
                const restored = formatEnv(saved.current)
                latest.current = restored
                setText(restored)
                setConfirmEmpty(false)
                onAccept()
              }}
            >
              {t('取消')}
            </Button>
            <Button
              size="small"
              onClick={() => {
                setConfirmEmpty(false)
                send({})
              }}
            >
              {t('保存')}
            </Button>
          </>
        ) : (
          status
        )}
        <TextField
          multiline
          rows={3}
          aria-label={t('环境变量')}
          style={{ width: 320 }}
          placeholder="KEY=VALUE"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            latest.current = e.target.value
            setConfirmEmpty(false)
          }}
          onBlur={() => commit(text, false)}
        />
      </span>
    </GroupRow>
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
  return (
    <GroupRow label={t('版本')} description={updateLabel(state) ?? undefined}>
      <span className="dk-inline">
        <span className="dk-value">{version ? `v${version}` : ''}</span>
        <UpdateAction />
      </span>
    </GroupRow>
  )
}

export function SettingsPage(_: PageProps) {
  const info = useDaemon((s) => s.info)
  const settingsQ = useIpc(ipc.settings)
  const [patch, setPatch] = useState<Partial<Settings>>({})
  const settings: Settings | null = settingsQ.data ? { ...settingsQ.data, ...patch } : null
  const [theme, setThemeState] = useState<ThemePreference>(() => getTheme())
  const [glass, setGlassState] = useState<GlassPreference>(() => getGlass())
  const [diagOpen, setDiagOpen] = useState(false)
  const [savingToggles, setSavingToggles] = useState<Record<string, boolean>>({})

  const toggle =
    (key: 'autoUpgrade' | 'launchAtLogin' | 'hideDockOnClose', save: (on: boolean) => Promise<void>) =>
    async (on: boolean) => {
      if (savingToggles[key]) return
      setSavingToggles((s) => ({ ...s, [key]: true }))
      try {
        await save(on)
        setPatch((p) => ({ ...p, [key]: on }))
        if (key === 'autoUpgrade') {
          useUpdate.setState({ auto: on })
          if (on) void checkForUpdate()
        }
      } catch (e) {
        fail(e)
      } finally {
        setSavingToggles((s) => ({ ...s, [key]: false }))
      }
    }

  const unbind = useUnbind()

  const saves = useSaves()
  const saveMirror = (mirror: Mirror) =>
    saves.save('mirror', async () => {
      await ipc.setMirror(mirror).catch((e) => {
        throw new Error(String(e))
      })
      setPatch((p) => ({ ...p, mirror }))
      return undefined
    })

  const saveEnv = (env: Record<string, string>) =>
    saves.save('env', async () => {
      await ipc.setEnv(env).catch((e) => {
        throw new Error(String(e))
      })
      setPatch((p) => ({ ...p, env }))
      return undefined
    })

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
      {!settings && settingsQ.error ? (
        <Alert
          variant="error"
          description={settingsQ.error}
          retrying={settingsQ.loading}
          onRetry={() => void settingsQ.reload()}
        />
      ) : null}
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
      {settings || !settingsQ.error ? (
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
      ) : null}
      {settings ? (
        <GroupBox>
          <EnvRows
            env={settings.env}
            status={<SaveStatus state={saves.status('env')} />}
            onSave={saveEnv}
            onRefuse={(error) => saves.refuse('env', error)}
            onAccept={() => saves.accept('env')}
          />
        </GroupBox>
      ) : null}
      <GroupBox>
        <GroupRow label={t('工作区根目录')} description={t('托管工作区与附件目录')}>
          {info ? <PathValue path={info.workspacesDir} /> : <Skeleton count={1} width={160} />}
        </GroupRow>
        <GroupRow label={t('备份目录')} description={t('被覆盖的本地修改、中断的半成品')}>
          {info ? <PathValue path={info.backupsDir} /> : <Skeleton count={1} width={160} />}
        </GroupRow>
        <GroupRow
          label={t('服务器')}
          description={
            !info?.server || info.server.startsWith('https://')
              ? t('由本机主动加密连接服务器')
              : t('由本机主动连接服务器（当前为未加密 HTTP）')
          }
        >
          <span className="dk-value">{host(info?.server)}</span>
        </GroupRow>
        <GroupRow label={t('连接诊断')} onClick={() => setDiagOpen(true)} />
      </GroupBox>
      <GroupBox>
        <GroupRow label={t('解除绑定…')} destructive onClick={unbind.request} />
      </GroupBox>
      <p className="dk-footnote">{t('解除绑定后清除团队密钥与托管工作区，本机备份保留。')}</p>
      <ConnectionDiagnosticsDialog open={diagOpen} onClose={() => setDiagOpen(false)} />
      {unbind.dialog}
    </>
  )
}
