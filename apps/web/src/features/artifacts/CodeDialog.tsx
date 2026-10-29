import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { Alert, Button, Dialog, Spinner, Tokens, useHighlight } from '../../ui'

/** A screen's source (View Code ⇧C): numbered, highlighted lines and a copy button. */
export function CodeDialog({
  title,
  load,
  onClose,
}: {
  title: string
  load: () => Promise<string>
  onClose: () => void
}) {
  const [state, setState] = useState<{ code: string | null; error: string }>({ code: null, error: '' })
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once per opened dialog
  useEffect(() => {
    let live = true
    load().then(
      (code) => live && setState({ code, error: '' }),
      (e) => live && setState({ code: null, error: errorText(e) }),
    )
    return () => {
      live = false
    }
  }, [])
  const { code, error } = state
  const tokens = useHighlight(code ?? '', code === null ? null : 'html')
  const lines = code === null ? [] : code.split('\n')
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width={960}
      footer={
        <Button
          icon="copy"
          disabled={code === null}
          onClick={() => code !== null && void copyWithToast(code, t('已复制代码'))}
        >
          {t('复制代码')}
        </Button>
      }
    >
      {error ? (
        <Alert variant="error" description={error} />
      ) : code === null ? (
        <div className="art-code__wait">
          <Spinner />
        </div>
      ) : (
        <pre className="art-code" data-testid="art-code">
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <div key={i} className="art-code__line">
              <span className="art-code__no">{i + 1}</span>
              <code>{tokens?.[i] ? <Tokens tokens={tokens[i]} /> : line || ' '}</code>
            </div>
          ))}
        </pre>
      )}
    </Dialog>
  )
}
