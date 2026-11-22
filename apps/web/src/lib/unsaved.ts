import { useEffect } from 'react'

/** Warns before leaving or refreshing the page while unsaved changes exist. */
export function useUnsavedWarn(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
