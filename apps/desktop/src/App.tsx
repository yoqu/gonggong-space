import { Toaster } from '@web/ui'
import { useEffect, useState } from 'react'
import { Onboarding } from './onboarding/Onboarding'
import { Shell } from './shell/Shell'
import { TitleBar } from './shell/TitleBar'
import { connectDaemon, refreshInfo, useDaemon } from './store'

export function App() {
  const info = useDaemon((s) => s.info)
  const phase = useDaemon((s) => s.snapshot.phase)
  const [onboarding, setOnboarding] = useState(false)

  useEffect(() => {
    const unlisten = connectDaemon()
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
      <TitleBar />
      {!info ? null : onboarding ? <Onboarding onDone={() => setOnboarding(false)} /> : <Shell />}
      <Toaster />
    </div>
  )
}
