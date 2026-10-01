import type { Permission } from '@gonggong/protocol'
import { Button, GroupBox, Icon, Tag, toast } from '@web/ui'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { ipc } from '../ipc'
import { PERMISSIONS, refreshPermissions, usePermissions } from '../permissions'
import { TitleBar } from '../shell/TitleBar'

/** System Settings is where the switch is flipped: poll while the guide is open, and at once on coming back. */
const POLL_MS = 2000

/**
 * 系统权限 (macOS): what the previews need and why, each asked for by this app so macOS lists 共工空间 — the daemon and
 * gg-cast run under it. Shown after binding, on the first launch that finds one missing, and from the reminders.
 */
export function PermissionsGuide({ onDone }: { onDone: () => void }) {
  const list = usePermissions((s) => s.list)
  const [asked, setAsked] = useState<Permission[]>([])

  useEffect(() => {
    const refresh = () => void refreshPermissions().catch(() => {})
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const request = async (kind: Permission) => {
    setAsked((a) => (a.includes(kind) ? a : [...a, kind]))
    await ipc.requestPermission(kind).catch((e) => toast({ type: 'error', message: String(e) }))
  }

  const done = list.length > 0 && list.every((p) => p.granted)
  const screenAsked = asked.includes('screen_recording')

  return (
    <>
      <TitleBar lights scrolled={false} />
      <div className="dk-onboarding">
        <div className="dk-onboarding__panel">
          <h1 className="dk-onboarding__title">{t('授予系统权限')}</h1>
          <p className="dk-onboarding__desc">
            {t(
              'Bot 推送本机桌面应用和小程序的实时画面、成员远程操作时，需要 macOS 授予「共工空间」以下权限。未授权不影响其他功能。',
            )}
          </p>
          <GroupBox>
            {list.map((p) => {
              const { label, icon, why } = PERMISSIONS[p.kind]
              return (
                <div key={p.kind} className="dk-row" data-testid="permission">
                  <Icon
                    name={icon}
                    size={16}
                    color={p.granted ? 'var(--system-green)' : 'var(--system-orange)'}
                  />
                  <div className="dk-row__main">
                    <span>{label}</span>
                    <span className="dk-sub">{why}</span>
                  </div>
                  <Tag tone={p.granted ? 'green' : 'orange'}>{p.granted ? t('已授权') : t('未授权')}</Tag>
                  {p.granted ? null : (
                    <Button size="small" onClick={() => void request(p.kind)}>
                      {t('去授权')}
                    </Button>
                  )}
                </div>
              )
            })}
          </GroupBox>
          <p className="dk-footnote">
            {t(
              '在系统设置中打开「共工空间」的开关后回到这里，状态会自动刷新。屏幕录制需重启共工空间后才生效。',
            )}
          </p>
          {screenAsked && !done ? (
            <Button onClick={() => void ipc.restartApp()}>{t('重启共工空间')}</Button>
          ) : null}
          <Button variant="primary" size="xlarge" fullWidth onClick={onDone}>
            {done ? t('完成') : t('稍后')}
          </Button>
        </div>
      </div>
    </>
  )
}
