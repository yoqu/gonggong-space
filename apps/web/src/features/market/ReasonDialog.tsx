import { useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Dialog, TextArea, toast } from '../../ui'

/** Destructive confirmation dialog requiring a non-empty reason (e.g. banning a listing or rejecting a request). */
export function ReasonDialog({
  title,
  note,
  fieldLabel,
  placeholder,
  confirmLabel,
  done,
  run,
  onClose,
  onDone,
}: {
  title: string
  note: string
  fieldLabel: string
  placeholder: string
  confirmLabel: string
  done: string
  run: (reason: string) => Promise<unknown>
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => {
    if (!busy) onClose()
  }
  const submit = async () => {
    const trimmed = reason.trim()
    if (busy || !trimmed) return
    setBusy(true)
    setError('')
    try {
      await run(trimmed)
      toast({ type: 'success', message: done })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={title}
      width={480}
      closeOnScrim={false}
      onClose={close}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        {
          label: confirmLabel,
          variant: 'destructive',
          disabled: busy || !reason.trim(),
          loading: busy,
          onClick: () => void submit(),
        },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      <div className="gs-note">{note}</div>
      <TextArea
        label={fieldLabel}
        aria-label={fieldLabel}
        placeholder={placeholder}
        maxLength={500}
        disabled={busy}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Dialog>
  )
}
