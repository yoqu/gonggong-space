import { isValidElement, memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '../../i18n'
import { CodeBlock, toast } from '../../ui'

const copyFailed = () => toast({ type: 'error', message: t('复制失败') })

/** Fenced code: the single `<code>` child of `<pre>`, its language from `language-*`. */
function fenced(children: ReactNode) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : null
  const text = String(code?.children ?? '').replace(/\n$/, '')
  const language = /language-([\w+-]+)/.exec(code?.className ?? '')?.[1]
  return { text, language }
}

interface MdNode {
  type: string
  url?: string
  value?: string
  children?: MdNode[]
}

/** CJK text and full-width punctuation: GFM only ends a bare URL at whitespace, so `（http://x）。然后` would swallow them. */
const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/

/** Cuts literal autolinks (link text = end of its url) at the first CJK character, which goes back to plain text. */
function trimAutolinks(node: MdNode) {
  const kids = node.children
  if (!kids) return
  for (let i = 0; i < kids.length; i++) {
    const link = kids[i]
    const text = link?.children?.length === 1 ? link.children[0] : undefined
    const at = text?.type === 'text' ? (text.value ?? '').search(CJK) : -1
    if (link?.type !== 'link' || !text?.value || !link.url?.endsWith(text.value) || at < 0) {
      if (link) trimAutolinks(link)
      continue
    }
    const rest = text.value.slice(at)
    link.url = link.url.slice(0, -rest.length)
    text.value = text.value.slice(0, at)
    kids.splice(i + 1, 0, { type: 'text', value: rest })
  }
}

const remarkPlugins = [remarkGfm, () => trimAutolinks]

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
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
