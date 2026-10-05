import { AlertDialog, NotificationBanner } from '@web/ui'
import { useState } from 'react'
import logo from '../assets/logo.svg'
import { t } from '../i18n'
import { activeRuns, restartToUpdate, useUpdate } from '../updater'

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
      title={t('有运行中的任务，重启会中断')}
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

/** Non-blocking notice once an update has been downloaded. */
export function UpdateBanner() {
  const { state, dismissed } = useUpdate()
  const restart = useRestartToUpdate()
  return (
    <>
      {state.phase === 'ready' && !dismissed ? (
        <div className="dk-update">
          <NotificationBanner
            app={{ name: t('共工空间'), icon: <img src={logo} alt="" width={20} height={20} /> }}
            title={t('发现新版本')}
            body={t('新版本 v{v} 已下载，重启以更新', { v: state.version })}
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
