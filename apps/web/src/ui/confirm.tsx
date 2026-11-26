import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/api'
import { Alert } from './display'
import { AlertDialog } from './overlay'
import { toast } from './toast'

/** Destructive confirmation listing its consequences; a failure stays in the dialog, success toasts `done`. */
export function ConfirmActionDialog({
  title,
  message,
  consequences,
  label,
  done,
  run,
  onDone,
  onClose,
}: {
  title: string
  message: string
  consequences: string[]
  label: string
  done: string
  run: () => Promise<unknown>
  /** Defaults to `onClose`. */
  onDone?: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => {
    if (!busy) onClose()
  }
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await run()
      toast({ type: 'success', message: done })
      ;(onDone ?? onClose)()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <AlertDialog
      open
      title={title}
      message={message}
      detail={
        consequences.length || error ? (
          <>
            {consequences.length ? (
              <ul className="ui-consequences">
                {consequences.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
            {error ? <Alert variant="error" description={error} /> : null}
          </>
        ) : undefined
      }
      onClose={close}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        { label, variant: 'destructive', disabled: busy, loading: busy, onClick: () => void confirm() },
      ]}
    />
  )
}
