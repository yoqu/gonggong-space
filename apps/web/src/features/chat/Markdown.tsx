import { type ComponentProps, isValidElement, memo, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { cx } from '../../lib/cx'
import { Icon, toast } from '../../ui'

/** Blocks longer than this are capped (about 400px) until expanded. */
const LONG_LINES = 20

function CodeBlock({ children }: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const [long, setLong] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const className = isValidElement<{ className?: string }>(children) ? (children.props.className ?? '') : ''
  const lang = /language-([\w+-]+)/.exec(className)?.[1] ?? 'text'
  useLayoutEffect(() => {
    setLong((ref.current?.textContent ?? '').trimEnd().split('\n').length > LONG_LINES)
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? '')
    } catch {
      toast({ type: 'error', message: '复制失败' })
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={cx('md-code', long && !expanded && 'md-code--capped')}>
      <div className="md-code__head">
        <span className="md-code__lang">{lang}</span>
        {long ? (
          <button type="button" className="md-code__copy" onClick={() => setExpanded(!expanded)}>
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
            {expanded ? '收起' : '展开'}
          </button>
        ) : null}
        <button type="button" className="md-code__copy" onClick={() => void copy()}>
          <Icon name={copied ? 'check' : 'copy'} size={12} />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  )
}

const components: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

/** Bot reply rendering: GFM (tables, task lists) + highlighted code blocks with copy. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
