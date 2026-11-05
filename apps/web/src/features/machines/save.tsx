import { useRef, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Button, Icon } from '../../ui'

export type SaveState =
  | { phase: 'saving' }
  | { phase: 'saved'; note?: string }
  | { phase: 'failed'; error: string; retry?: () => void }

/**
 * Save-on-change status per control key. Saves run one at a time, so a later change never lands before an earlier
 * one; a task may return a note shown after 已保存.
 */
export function useSaves() {
  const [states, setStates] = useState<Record<string, SaveState>>({})
  const queue = useRef(Promise.resolve())
  const set = (key: string, s: SaveState) => setStates((x) => ({ ...x, [key]: s }))
  const save = (key: string, task: () => Promise<string | undefined>) => {
    set(key, { phase: 'saving' })
    queue.current = queue.current.then(async () => {
      try {
        set(key, { phase: 'saved', note: await task() })
      } catch (e) {
        set(key, { phase: 'failed', error: errorText(e), retry: () => save(key, task) })
      }
    })
  }
  /** A value refused before it is sent (nothing to retry until it is changed). */
  const refuse = (key: string, error: string) => set(key, { phase: 'failed', error })
  return { status: (key: string) => states[key], save, refuse }
}

/** 保存中… → 已保存 ✓ → 保存失败：reason [重试], beside the control it is about. */
export function SaveStatus({ state }: { state: SaveState | undefined }) {
  return (
    <span className="mx-save" role="status" data-phase={state?.phase}>
      {!state ? null : state.phase === 'saving' ? (
        t('保存中…')
      ) : state.phase === 'saved' ? (
        <>
          <Icon name="check" size={12} />
          {[t('已保存'), state.note].filter(Boolean).join(' · ')}
        </>
      ) : (
        <>
          {t('保存失败：{error}', { error: state.error })}
          {state.retry ? (
            <Button size="small" variant="plain" onClick={state.retry}>
              {t('重试')}
            </Button>
          ) : null}
        </>
      )}
    </span>
  )
}

/** Commits a text field on blur or Enter, once per distinct value: a blur right after Enter does not save again. */
export function commitOnBlur(value: string, last: { current: string }, commit: (v: string) => void) {
  const go = () => {
    if (value === last.current) return
    last.current = value
    commit(value)
  }
  return {
    onBlur: go,
    onKeyDown: (e: { key: string; nativeEvent: { isComposing: boolean } }) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) go()
    },
  }
}
