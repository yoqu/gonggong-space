import { useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Icon } from '../../ui'
import { Markdown } from '../chat/Markdown'

/** DESIGN.md without its YAML front matter: the card shows the prose (the tokens are on the design-system card). */
export const designMdBody = (md: string) => {
  const m = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(md)
  return (m ? md.slice(m[0].length) : md).trim()
}

/** The DESIGN.md node (Stitch's 📄 node): rendered read-only; a long one is cut off with a fade. */
export function DesignMdNode({ md }: { md: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measured when the text changes
  useLayoutEffect(() => {
    const el = box.current
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [md])
  return (
    <div ref={box} className={cx('art-doc', clipped && 'art-doc--clipped')} data-testid="art-design-md">
      <div className="art-doc__head">
        <Icon name="doc-text" size={14} />
        DESIGN.md
        <span>· {t('双击打开')}</span>
      </div>
      <Markdown text={designMdBody(md)} />
    </div>
  )
}
