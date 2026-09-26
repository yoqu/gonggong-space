import { Toaster, toast } from '@web/ui'
import { useEffect, useState } from 'react'
import { onOpenLinks } from './ipc'
import { host } from './lib/labels'
import { Onboarding } from './onboarding/Onboarding'
import { Shell } from './shell/Shell'
import { TitleBar } from './shell/TitleBar'
import { connectDaemon, refreshInfo, useDaemon } from './store'

export function App() {
  const info = useDaemon((s) => s.info)
  const phase = useDaemon((s) => s.snapshot.phase)
  const [onboarding, setOnboarding] = useState(false)
  // The latest 接入链接 opened while unbound, for the onboarding to prefill (plan J3: never bound by itself).
  const [link, setLink] = useState<{ url: string } | null>(null)

  useEffect(() => {
    const open = (urls: string[]) => {
      const url = urls[urls.length - 1]
      const server = useDaemon.getState().info?.server
      if (!url) return
      if (server) toast({ type: 'warning', message: `本机已绑定到 ${host(server)}，请先在设置中解绑` })
      else setLink({ url })
    }
    // Links are handled once the binding is known.
    const unlisten = connectDaemon().then(async (stopDaemon) => {
      const stopLinks = await onOpenLinks(open)
      return () => {
        stopDaemon()
        stopLinks()
      }
    })
    return () => {
      unlisten.then((f) => f())
    }
  }, [])

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
          }}
        />
      ) : (
        <Shell />
      )}
      <Toaster />
    </div>
  )
}
