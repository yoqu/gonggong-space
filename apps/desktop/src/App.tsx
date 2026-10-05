import { Toaster, toast } from '@web/ui'
import { useEffect, useState } from 'react'
import { t } from './i18n'
import { onOpenLinks } from './ipc'
import { host } from './lib/labels'
import { Onboarding } from './onboarding/Onboarding'
import { PermissionsGuide } from './onboarding/Permissions'
import { closeGuide, openGuide, refreshPermissions, usePermissions } from './permissions'
import { Shell } from './shell/Shell'
import { TitleBar } from './shell/TitleBar'
import { UpdateBanner } from './shell/UpdateBanner'
import { connectDaemon, refreshInfo, useDaemon } from './store'
import { startUpdater } from './updater'

/** The guide opens by itself once per install (and after every binding); later only from the reminders. */
const GUIDE_SEEN = 'gg.permissionsGuide'

function guideSeen() {
  try {
    const seen = localStorage.getItem(GUIDE_SEEN) === 'seen'
    localStorage.setItem(GUIDE_SEEN, 'seen')
    return seen
  } catch {
    return false
  }
}

async function offerGuide(always: boolean) {
  const list = await refreshPermissions().catch(() => [])
  if (list.some((p) => !p.granted) && (always || !guideSeen())) openGuide()
}

export function App() {
  const info = useDaemon((s) => s.info)
  const guide = usePermissions((s) => s.guide)
  const phase = useDaemon((s) => s.snapshot.phase)
  const [onboarding, setOnboarding] = useState(false)
  // The latest 接入链接 opened while unbound, for the onboarding to prefill (plan J3: never bound by itself).
  const [link, setLink] = useState<{ url: string } | null>(null)

  useEffect(() => {
    const open = (urls: string[]) => {
      const url = urls[urls.length - 1]
      const server = useDaemon.getState().info?.server
      if (!url) return
      if (server)
        toast({
          type: 'warning',
          message: t('本机已绑定到 {host}，请先在设置中解绑', { host: host(server) }),
        })
      else setLink({ url })
    }
    // Links are handled once the binding is known.
    const unlisten = connectDaemon().then(async (stopDaemon) => {
      if (useDaemon.getState().info?.server) void offerGuide(false)
      const stopLinks = await onOpenLinks(open)
      return () => {
        stopDaemon()
        stopLinks()
      }
    })
    // Coming back from System Settings updates the reminders.
    const refresh = () => void refreshPermissions().catch(() => {})
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      unlisten.then((f) => f())
    }
  }, [])

  useEffect(startUpdater, [])

  // Unbinding (or rebinding after a revocation) stops the daemon: re-read the binding.
  useEffect(() => {
    if (phase === 'unbound') refreshInfo()
  }, [phase])

  // Not bound and not running → first-run flow, kept until its last step even once the daemon is up.
  useEffect(() => {
    if (info && !info.server && phase === 'unbound') setOnboarding(true)
  }, [info, phase])

  return (
    <div className="dk-window">
      {!info ? (
        <TitleBar lights scrolled={false} />
      ) : onboarding ? (
        <Onboarding
          link={link}
          onDone={() => {
            setOnboarding(false)
            setLink(null)
            void offerGuide(true)
          }}
        />
      ) : guide ? (
        <PermissionsGuide onDone={closeGuide} />
      ) : (
        <Shell />
      )}
      <UpdateBanner />
      <Toaster />
    </div>
  )
}
