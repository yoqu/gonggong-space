import { parseUiBlock } from '@gonggong/protocol'
import { memo, useContext, useMemo } from 'react'
import { CodeBlock } from '../../ui'
import { Actions } from './Actions'
import { RichMessage } from './context'
import { HtmlRender } from './HtmlRender'
import { Mermaid } from './Mermaid'
import './rich.css'

/** ```html-page: the reply's html_render page it names; a page of no reply here (another run's) shows nothing. */
function PlacedPage({ id }: { id: string }) {
  const page = useContext(RichMessage)?.htmlRenders?.find((p) => p.attachmentId === id)
  return page ? <HtmlRender page={page} /> : null
}

/**
 * A closed fenced code block of a reply: its component when the language names a valid UI block (plan 富交互消息),
 * else the plain code block. Memoized on the source, so streaming text around it never remounts it.
 */
export const RichBlock = memo(function RichBlock({
  language,
  text,
  onCopyError,
}: {
  language: string
  text: string
  onCopyError: () => void
}) {
  const block = useMemo(() => parseUiBlock(language, text), [language, text])
  const code = <CodeBlock code={text} language={language} onCopyError={onCopyError} />
  switch (block?.lang) {
    case 'actions':
      return <Actions data={block.data} />
    case 'mermaid':
      return <Mermaid source={block.source} fallback={code} />
    case 'html-page':
      return <PlacedPage id={block.id} />
    default:
      return code
  }
})
