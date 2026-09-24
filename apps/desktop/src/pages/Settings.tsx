import { Button, Dialog, Switch, Tabs, toast } from '@web/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { ipc, type Settings } from '../ipc'
import { host, tildify } from '../lib/labels'
import { useDaemon } from '../store'
import { getTheme, setTheme, type ThemePreference } from '../theme'
import type { PageProps } from '.'

const APPEARANCE: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

export function SettingsPage(_: PageProps) {
  const info = useDaemon((s) => s.info)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [theme, setThemeState] = useState<ThemePreference>(() => getTheme())
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
      <div className="dk-list">
        <Row k="外观" d="浅色、深色或跟随系统">
          <Tabs
            size="sm"
            items={APPEARANCE}
            value={theme}
            onChange={(v) => {
              setTheme(v)
              setThemeState(v)
            }}
          />
        </Row>
        <Row k="自动升级" d="服务器公布协议版本，不兼容时拒绝连接并提示升级">
          <Switch
            label={<span className="dk-sr-only">自动升级</span>}
            checked={settings?.autoUpgrade ?? false}
            disabled={!settings}
            onChange={toggle('autoUpgrade', ipc.setAutoUpgrade)}
          />
        </Row>
        <Row k="开机启动" d="登录系统后在后台运行">
          <Switch
            label={<span className="dk-sr-only">开机启动</span>}
            checked={settings?.launchAtLogin ?? false}
            disabled={!settings}
            onChange={toggle('launchAtLogin', ipc.setLaunchAtLogin)}
          />
        </Row>
        <Row k="工作区根目录" d="托管工作区与附件目录">
          <span className="dk-value">{info ? tildify(info.workspacesDir) : ''}</span>
        </Row>
        <Row k="备份目录" d="被覆盖的本地修改、中断的半成品">
          <span className="dk-value">{info ? tildify(info.backupsDir) : ''}</span>
        </Row>
        <Row k="服务器" d="只出站连接 · HTTPS / WSS">
          <span className="dk-value">{host(info?.server)}</span>
        </Row>
      </div>
      <div className="dk-inline">
        <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
          解除绑定
        </Button>
        <span className="dk-sub">解除后清除团队密钥与托管工作区，本机备份保留。</span>
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="解除绑定？"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={() => ipc.unbind()}>
              解除绑定
            </Button>
          </>
        }
      >
        本机将断开与服务器的连接，清除团队密钥与托管工作区（/cd
        绑定的目录与本机备份保留），并回到首次绑定引导。
      </Dialog>
    </>
  )
}

function Row({ k, d, children }: { k: string; d: string; children: ReactNode }) {
  return (
    <div className="dk-list__row">
      <div className="dk-row__main">
        <span>{k}</span>
        <span className="dk-sub">{d}</span>
      </div>
      {children}
    </div>
  )
}
