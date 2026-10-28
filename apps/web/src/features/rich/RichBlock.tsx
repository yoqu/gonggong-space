import { parseUiBlock } from '@gonggong/protocol'
import { memo, useMemo } from 'react'
import { CodeBlock } from '../../ui'
import { Actions } from './Actions'
import { Mermaid } from './Mermaid'
import './rich.css'

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
    default:
      return code
  }
})
