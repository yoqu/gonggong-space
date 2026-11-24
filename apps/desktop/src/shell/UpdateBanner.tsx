import { AlertDialog, Button, NotificationBanner, usePresence } from '@web/ui'
import { useRef, useState } from 'react'
import logo from '../assets/logo.svg'
import logoSmall from '../assets/logo-small.svg'
import { t } from '../i18n'
import { activeRuns, checkForUpdate, restartToUpdate, useUpdate } from '../updater'

/** 立即重启, confirmed first when runs on this machine would be interrupted. */
export function useRestartToUpdate() {
  const [runs, setRuns] = useState(0)
  const request = () => {
    const n = activeRuns()
    if (n > 0) setRuns(n)
    else void restartToUpdate()
  }
  const dialog = (
    <AlertDialog
      open={runs > 0}
      onClose={() => setRuns(0)}
      icon={<img src={logo} alt="" width={48} height={48} />}
      title={t('要重启并中断运行中的任务吗？')}
      message={t('本机有 {n} 个任务正在运行，重启后它们会被中断。', { n: runs })}
      actions={[
        { label: t('取消'), onClick: () => setRuns(0) },
        {
          label: t('仍然重启'),
          variant: 'destructive',
          onClick: () => {
            setRuns(0)
            void restartToUpdate()
          },
        },
      ]}
    />
  )
  return { request, dialog }
}

/** 立即重启 once an update is downloaded, else 检查更新 (disabled while one is under way). */
export function UpdateAction({ size }: { size?: 'small' }) {
  const state = useUpdate((s) => s.state)
  const restart = useRestartToUpdate()
  const busy = state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing'
  return (
    <>
      {state.phase === 'ready' ? (
        <Button variant="primary" size={size} onClick={restart.request}>
          {t('立即重启')}
        </Button>
      ) : (
        <Button size={size} disabled={busy} onClick={() => void checkForUpdate()}>
          {t('检查更新')}
        </Button>
      )}
      {restart.dialog}
    </>
  )
}

/** Non-blocking notice once an update has been downloaded. */
export function UpdateBanner() {
  const { state, dismissed, auto } = useUpdate()
  const restart = useRestartToUpdate()
  const open = state.phase === 'ready' && !dismissed
  const presence = usePresence(open)
  const lastReady = useRef<{ version: string; notes?: string } | null>(null)
  if (state.phase === 'ready') lastReady.current = { version: state.version, notes: state.notes }
  const shown = state.phase === 'ready' ? state : lastReady.current
  return (
    <>
      {presence.mounted && shown ? (
        <div
          className="dk-update"
          data-state={presence.state}
          aria-hidden={presence.state === 'closed' || undefined}
          inert={presence.state === 'closed'}
          onAnimationEnd={presence.onAnimationEnd}
        >
          <NotificationBanner
            app={{ name: t('共工空间'), icon: <img src={logoSmall} alt="" width={20} height={20} /> }}
            title={t('发现新版本')}
            body={
              <>
                <div>
                  {auto
                    ? t('新版本 v{v} 已下载，本机任务结束后自动重启更新', { v: shown.version })
                    : t('新版本 v{v} 已下载，重启以更新', { v: shown.version })}
                </div>
                {shown.notes ? <pre className="dk-update__notes">{shown.notes}</pre> : null}
              </>
            }
            actions={[
              { label: t('立即重启'), onClick: restart.request },
              { label: t('稍后'), onClick: () => useUpdate.setState({ dismissed: true }) },
            ]}
          />
        </div>
      ) : null}
      {restart.dialog}
    </>
  )
}
