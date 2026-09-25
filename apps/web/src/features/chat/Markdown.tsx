import { isValidElement, memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock, toast } from '../../ui'

const copyFailed = () => toast({ type: 'error', message: '复制失败' })

/** Fenced code: the single `<code>` child of `<pre>`, its language from `language-*`. */
function fenced(children: ReactNode) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : null
  const text = String(code?.children ?? '').replace(/\n$/, '')
  const language = /language-([\w+-]+)/.exec(code?.className ?? '')?.[1]
  return { text, language }
}

const components: Components = {
  pre: ({ children }) => {
    const { text, language } = fenced(children)
    return <CodeBlock code={text} language={language} onCopyError={copyFailed} />
  },
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

/** Bot reply rendering: GFM (tables, task lists) + Pane code blocks with copy. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
