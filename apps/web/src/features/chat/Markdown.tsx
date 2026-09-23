import { Check, Copy } from 'lucide-react'
import { type ComponentProps, isValidElement, memo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

function CodeBlock({ children }: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const className = isValidElement<{ className?: string }>(children) ? (children.props.className ?? '') : ''
  const lang = /language-([\w+-]+)/.exec(className)?.[1] ?? 'text'
  const copy = async () => {
    await navigator.clipboard.writeText(ref.current?.textContent ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="md-code">
      <div className="md-code__head">
        <span className="md-code__lang">{lang}</span>
        <button type="button" className="md-code__copy" onClick={() => void copy()}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
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
