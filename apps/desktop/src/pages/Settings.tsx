import { type GlassPreference, getGlass, setGlass } from '@web/app/glass'
import {
  AlertDialog,
  Button,
  GroupBox,
  GroupRow,
  HelpButton,
  PopUpButton,
  SegmentedControl,
  Skeleton,
  Switch,
  TextField,
  toast,
} from '@web/ui'
import { useEffect, useState } from 'react'
import logo from '../assets/logo.svg'
import { ipc, type Mirror, type Settings } from '../ipc'
import { host } from '../lib/labels'
import { PathValue } from '../lib/ui'
import { useDaemon } from '../store'
import { getTheme, setTheme, type ThemePreference } from '../theme'
import type { PageProps } from '.'

const APPEARANCE: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

const GLASS: { value: GlassPreference; label: string }[] = [
  { value: 'clear', label: '清透' },
  { value: 'standard', label: '标准' },
  { value: 'tinted', label: '着色' },
]

const MIRRORS: { value: Mirror['kind']; label: string }[] = [
  { value: 'npmmirror', label: '淘宝镜像（npmmirror）' },
  { value: 'official', label: '官方源' },
  { value: 'custom', label: '自定义' },
]

/** 镜像源 of Node.js and the agent CLIs; a custom one takes both addresses before it is saved. */
function MirrorRows({ mirror, onSave }: { mirror: Mirror; onSave: (m: Mirror) => Promise<void> }) {
  const [kind, setKind] = useState(mirror.kind)
  const [registry, setRegistry] = useState(mirror.kind === 'custom' ? mirror.registry : '')
  const [node, setNode] = useState(mirror.kind === 'custom' ? mirror.node : '')
  const changed = mirror.kind !== 'custom' || mirror.registry !== registry || mirror.node !== node
  return (
    <>
      <GroupRow label="镜像源" description="安装、升级 Node.js、Claude Code 与 Codex 时从这里下载">
        <PopUpButton
          aria-label="镜像源"
          options={MIRRORS}
          value={kind}
          onChange={(k) => {
            setKind(k)
            if (k !== 'custom') onSave({ kind: k })
          }}
        />
      </GroupRow>
      {kind === 'custom' ? (
        <>
          <GroupRow label="npm registry">
            <TextField
              aria-label="npm registry"
              style={{ width: 320 }}
              placeholder="https://registry.example.com"
              value={registry}
              onChange={(e) => setRegistry(e.target.value)}
            />
          </GroupRow>
          <GroupRow label="Node.js 下载地址" description="index.json 所在的目录">
            <TextField
              aria-label="Node.js 下载地址"
              style={{ width: 320 }}
              placeholder="https://example.com/mirrors/node"
              value={node}
              onChange={(e) => setNode(e.target.value)}
            />
          </GroupRow>
          <div className="dk-row">
            <span className="dk-row__main" />
            <Button
              variant="primary"
              disabled={!registry.trim() || !node.trim() || !changed}
              onClick={() => onSave({ kind: 'custom', registry, node })}
            >
              保存
            </Button>
          </div>
        </>
      ) : null}
    </>
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
    (key: 'autoUpgrade' | 'launchAtLogin', save: (on: boolean) => Promise<void>) => async (on: boolean) => {
      try {
        await save(on)
        setSettings((s) => s && { ...s, [key]: on })
      } catch (e) {
        toast({ type: 'error', message: String(e) })
      }
    }

  const saveMirror = async (mirror: Mirror) => {
    try {
      await ipc.setMirror(mirror)
      setSettings((s) => s && { ...s, mirror })
      toast({ type: 'success', message: '镜像源已保存' })
    } catch (e) {
      toast({ type: 'error', message: String(e) })
    }
  }

  return (
    <>
      <GroupBox>
        <GroupRow label="主题">
          <SegmentedControl
            aria-label="主题"
            items={APPEARANCE}
            value={theme}
            onChange={(v) => {
              setTheme(v)
              setThemeState(v)
            }}
          />
        </GroupRow>
        <GroupRow label="玻璃效果" description="调节侧栏、菜单和浮层的透明程度">
          <SegmentedControl
            aria-label="玻璃效果"
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
        <GroupRow label="自动升级">
          <span className="dk-inline">
            <HelpButton help="服务器公布协议版本，不兼容时拒绝连接并提示升级。" />
            <Switch
              aria-label="自动升级"
              checked={settings?.autoUpgrade ?? false}
              disabled={!settings}
              onChange={toggle('autoUpgrade', ipc.setAutoUpgrade)}
            />
          </span>
        </GroupRow>
        <GroupRow label="开机启动" description="登录系统后在后台运行">
          <Switch
            aria-label="开机启动"
            checked={settings?.launchAtLogin ?? false}
            disabled={!settings}
            onChange={toggle('launchAtLogin', ipc.setLaunchAtLogin)}
          />
        </GroupRow>
      </GroupBox>
      <GroupBox>
        {settings ? (
          <MirrorRows mirror={settings.mirror} onSave={saveMirror} />
        ) : (
          <GroupRow label="镜像源">
            <Skeleton count={1} width={160} />
          </GroupRow>
        )}
      </GroupBox>
      <GroupBox>
        <GroupRow label="工作区根目录" description="托管工作区与附件目录">
          {info ? <PathValue path={info.workspacesDir} /> : <Skeleton count={1} width={160} />}
        </GroupRow>
        <GroupRow label="备份目录" description="被覆盖的本地修改、中断的半成品">
          {info ? <PathValue path={info.backupsDir} /> : <Skeleton count={1} width={160} />}
        </GroupRow>
        <GroupRow label="服务器" description="只出站连接 · HTTPS / WSS">
          <span className="dk-value">{host(info?.server)}</span>
        </GroupRow>
      </GroupBox>
      <GroupBox>
        <GroupRow label="解除绑定…" destructive onClick={() => setConfirming(true)} />
      </GroupBox>
      <p className="dk-footnote">解除绑定后清除团队密钥与托管工作区，本机备份保留。</p>
      <AlertDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        icon={<img src={logo} alt="" width={48} height={48} />}
        title="要解除本机与团队服务器的绑定吗？"
        message="本机将断开连接，清除团队密钥与托管工作区（/cd 绑定的目录与本机备份保留），并回到首次绑定引导。此操作不可撤销。"
        actions={[
          { label: '取消', onClick: () => setConfirming(false) },
          { label: '解除绑定', variant: 'destructive', onClick: () => ipc.unbind() },
        ]}
      />
    </>
  )
}
