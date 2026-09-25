import { type GlassPreference, getGlass, setGlass } from '@web/app/glass'
import { AlertDialog, Button, GroupBox, GroupRow, SegmentedControl, Switch, toast } from '@web/ui'
import { useEffect, useState } from 'react'
import { ipc, type Settings } from '../ipc'
import { host, tildify } from '../lib/labels'
import { Section } from '../lib/ui'
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

export function SettingsPage(_: PageProps) {
  const info = useDaemon((s) => s.info)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [theme, setThemeState] = useState<ThemePreference>(() => getTheme())
  const [glass, setGlassState] = useState<GlassPreference>(() => getGlass())
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    ipc.settings().then(setSettings, (e) => toast({ type: 'error', message: String(e) }))
  }, [])

  const toggle = (key: keyof Settings, save: (on: boolean) => Promise<void>) => async (on: boolean) => {
    try {
      await save(on)
      setSettings((s) => s && { ...s, [key]: on })
    } catch (e) {
      toast({ type: 'error', message: String(e) })
    }
  }

  return (
    <>
      <Section title="外观">
        <GroupBox>
          <GroupRow label="主题" description="浅色、深色或跟随系统">
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
          <GroupRow label="玻璃效果" description="清透、标准或着色">
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
      </Section>
      <Section title="通用">
        <GroupBox>
          <GroupRow label="自动升级" description="服务器公布协议版本，不兼容时拒绝连接并提示升级">
            <Switch
              aria-label="自动升级"
              checked={settings?.autoUpgrade ?? false}
              disabled={!settings}
              onChange={toggle('autoUpgrade', ipc.setAutoUpgrade)}
            />
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
      </Section>
      <Section title="存储与连接">
        <GroupBox>
          <GroupRow label="工作区根目录" description="托管工作区与附件目录">
            <span className="dk-value">{info ? tildify(info.workspacesDir) : ''}</span>
          </GroupRow>
          <GroupRow label="备份目录" description="被覆盖的本地修改、中断的半成品">
            <span className="dk-value">{info ? tildify(info.backupsDir) : ''}</span>
          </GroupRow>
          <GroupRow label="服务器" description="只出站连接 · HTTPS / WSS">
            <span className="dk-value">{host(info?.server)}</span>
          </GroupRow>
        </GroupBox>
      </Section>
      <Section title="绑定">
        <GroupBox>
          <GroupRow label="解除绑定" description="解除后清除团队密钥与托管工作区，本机备份保留。">
            <Button variant="destructive" onClick={() => setConfirming(true)}>
              解除绑定…
            </Button>
          </GroupRow>
        </GroupBox>
      </Section>
      <AlertDialog
        open={confirming}
        onClose={() => setConfirming(false)}
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
