import type { FilesFindDto } from '@gonggong/protocol'
import { createContext, isValidElement, memo, type ReactNode, useContext, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useWorkbench } from '../../app/workbench'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { CJK } from '../../lib/links'
import { CodeBlock, Dialog, splitMentions, toast } from '../../ui'
import { docPath } from '../files/docPath'
import { RichBlock } from '../rich/RichBlock'
import { openTab } from '../workbench/open'

const copyFailed = () => toast({ type: 'error', message: t('复制失败') })

/** Fenced code: the single `<code>` child of `<pre>`, its language from `language-*`, closed per remarkFences. */
function fenced(children: ReactNode) {
  const code = isValidElement<{ className?: string; children?: ReactNode; 'data-closed'?: unknown }>(children)
    ? children.props
    : null
  const text = String(code?.children ?? '').replace(/\n$/, '')
  const language = /language-([\w+-]+)/.exec(code?.className ?? '')?.[1]
  return { text, language, closed: code?.['data-closed'] !== undefined }
}

interface MdNode {
  type: string
  url?: string
  value?: string
  children?: MdNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown> }
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const FENCE_OPEN = /^(`{3,}|~{3,})/

/** A fence's source ends with its closing fence (same character, at least as long); an open one runs to the end. */
function closedFence(source: string) {
  const lines = source.split('\n')
  const open = FENCE_OPEN.exec(lines[0] ?? '')?.[1]
  const last = lines.length > 1 ? (lines.at(-1) ?? '').replace(/^[\s>]*/, '').trimEnd() : ''
  return !!open && last.length >= open.length && [...last].every((c) => c === open[0])
}

/**
 * Marks fenced code whose closing fence has arrived (`data-closed`): a reply still streaming ends in an open fence,
 * and UI blocks mount only once closed, never on half their JSON.
 */
const remarkFences = () => (tree: MdNode, file: { value: unknown }) => {
  const source = String(file.value)
  const visit = (node: MdNode) => {
    if (node.type === 'code') {
      const { start, end } = node.position ?? { start: {}, end: {} }
      if (closedFence(source.slice(start.offset, end.offset)))
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataClosed: true } }
    }
    node.children?.forEach(visit)
  }
  visit(tree)
}

/** Cuts literal autolinks (link text = end of its url) at the first CJK character, which goes back to plain text. */
function trimAutolinks(node: MdNode) {
  const kids = node.children
  if (!kids) return
  for (let i = 0; i < kids.length; i++) {
    const link = kids[i]
    const text = link?.children?.length === 1 ? link.children[0] : undefined
    // Literal autolinks read as a url (`http…`, `www.…`) or an email; a written `[快速开始](#快速开始)` is neither.
    const literal = text?.type === 'text' && /^(?:https?:\/\/|www\.)|@/i.test(text.value ?? '')
    const at = literal ? (text.value ?? '').search(CJK) : -1
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

const remarkPlugins = [remarkGfm, () => trimAutolinks, remarkFences]

/** A file name with an extension (`a.ts`, `Markdown.test.tsx`) or a dotfile (`.env`); `v1.2` is not one. */
const FILE_NAME = /(?:^|\/)\.?[\w@-][\w@.-]*\.[A-Za-z]\w{0,7}$|(?:^|\/)\.[\w-]+$/
/** `path`, `path:from`, `path:from-to`, or `:from-to` alone (the previous file of the reply). */
const FILE_REF = /^([\w@.-]+(?:\/[\w@.-]+)*)?(?::(\d+)(?:-(\d+))?)?$/

type FileRefProps = {
  path: string
  from?: number
  to?: number
}

/** Inline code naming a workspace file, with its line range; `last` is the file the reply named before. */
function fileRef(code: string, last: string | null): FileRefProps | null {
  const m = FILE_REF.exec(code)
  if (!m || (!m[1] && !m[2])) return null
  const from = m[2] === undefined ? undefined : Number(m[2])
  const to = m[3] === undefined ? from : Number(m[3])
  if (from !== undefined && to !== undefined && to < from) return null
  const lines = from === undefined ? {} : { from, to }
  if (m[1] === undefined) return last ? { path: last, ...lines } : null
  const path = m[1].replace(/^\.\//, '')
  if (!FILE_NAME.test(path) || path.split('/').includes('..')) return null
  return { path, ...lines }
}

/**
 * Inline code that names a workspace file becomes a `file-ref` node; a bare `:from-to` reuses the file named
 * just before it in the same reply. Runs last, so mentions and autolinks never see the code.
 */
const remarkFileRefs = () => (tree: MdNode) => {
  let last: string | null = null
  const visit = (node: MdNode) => {
    if (!node.children || node.type === 'link') return
    node.children = node.children.map((c) => {
      if (c.type !== 'inlineCode') {
        visit(c)
        return c
      }
      const ref = fileRef(c.value ?? '', last)
      if (!ref) return c
      last = ref.path
      return {
        type: 'fileRef',
        data: { hName: 'file-ref', hProperties: ref },
        children: [{ type: 'text', value: c.value }],
      }
    })
  }
  visit(tree)
}

/** A workspace file a bot named: opens it in a file tab when the bot's workspace has it, else says so. */
function FileRef({
  botId,
  path,
  from,
  to,
  children,
}: FileRefProps & { botId: string; children?: ReactNode }) {
  const groupId = useWorkbench((s) => s.groupId)
  /** Several workspace files share a bare name: the user picks one. */
  const [picks, setPicks] = useState<string[] | null>(null)
  const base = `/groups/${groupId}/bots/${botId}/files`
  const show = (file: string) => {
    const line = from === undefined ? undefined : { from, to: to ?? from }
    openTab({ kind: 'file', source: { botId, path: file, ...(line ? { line } : {}) } })
  }
  const notFound = () => toast({ type: 'error', message: t('工作区里没找到') })
  const open = async () => {
    if (!groupId) return
    // A bare name is looked up in the workspace; a path is read where it says.
    if (!path.includes('/')) {
      let paths: string[]
      try {
        paths = (await api.get<FilesFindDto>(`${base}/find?name=${encodeURIComponent(path)}`)).paths
      } catch {
        return notFound()
      }
      if (paths.length > 1) return setPicks(paths)
      const [only] = paths
      return only ? show(only) : notFound()
    }
    try {
      await api.get(`${base}/text?path=${encodeURIComponent(path)}`)
    } catch {
      return notFound()
    }
    show(path)
  }
  return (
    <>
      <button type="button" className="md-file-ref" onClick={open}>
        <code>{children}</code>
      </button>
      <Dialog open={picks !== null} onClose={() => setPicks(null)} title={t('选择要打开的文件')} width={360}>
        <div className="md-file-picks">
          {picks?.map((p) => (
            <button
              key={p}
              type="button"
              className="md-file-pick"
              onClick={() => {
                setPicks(null)
                show(p)
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </Dialog>
    </>
  )
}

/** Names a reply may @ in this chat; without it (files, process view) an @ is plain text. */
interface Names {
  members: string[]
  bots: string[]
  me?: string
}
export const MentionNames = createContext<Names | null>(null)

/**
 * Bot reply @s: members highlight like in members' messages; bots grey, since a reply's @ never starts a bot (only
 * hand_off does). Text nodes only, so code is skipped; links keep their own text.
 */
function remarkMentions({ members, bots, me }: Names) {
  const isBot = new Set(bots)
  const names = [...bots, ...members]
  const mention = (name: string): MdNode => ({
    type: 'mention',
    data: {
      hName: 'span',
      hProperties: isBot.has(name)
        ? { className: ['pn-mention', 'pn-mention--bot'], title: t('仅提及，不会让 Bot 开始工作') }
        : { className: name === me ? ['pn-mention', 'pn-mention--me'] : ['pn-mention'] },
    },
    children: [{ type: 'text', value: `@${name}` }],
  })
  const visit = (node: MdNode) => {
    if (!node.children || node.type === 'link' || node.type === 'linkReference') return
    node.children = node.children.flatMap((c) => {
      if (c.type !== 'text') {
        visit(c)
        return [c]
      }
      return splitMentions(c.value ?? '', names).map((s) =>
        s.mention ? mention(s.text.slice(1)) : { type: 'text', value: s.text },
      )
    })
  }
  return () => visit
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to `-`, a repeat numbered `-1`, `-2`… */
const remarkSlugs = () => (tree: MdNode) => {
  const seen = new Map<string, number>()
  const text = (n: MdNode): string => n.value ?? n.children?.map(text).join('') ?? ''
  const visit = (n: MdNode) => {
    if (n.type !== 'heading') return n.children?.forEach(visit)
    const slug = text(n)
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
      .replace(/ /g, '-')
    const k = seen.get(slug) ?? 0
    seen.set(slug, k + 1)
    n.data = { ...n.data, hProperties: { ...n.data?.hProperties, id: k ? `${slug}-${k}` : slug } }
  }
  visit(tree)
}

/** Scrolls a document's heading to the top and flashes it, so the eye lands where the jump went. */
export function jumpTo(root: Element | null | undefined, id: string) {
  const el = root && [...root.querySelectorAll<HTMLElement>('[id]')].find((e) => e.id === id)
  if (!el) return
  el.scrollIntoView({ block: 'start' })
  el.removeAttribute('data-flash')
  void el.offsetWidth
  el.setAttribute('data-flash', '')
}

/** A workspace document's place: its relative images and links resolve from its folder (docPath). */
export interface MdDoc {
  path: string
  raw: (path: string) => string
  /** A file, or a folder (ending in `/`). */
  open: (path: string) => void
}

const unhash = (href: string) => {
  try {
    return decodeURIComponent(href.slice(1))
  } catch {
    return href.slice(1)
  }
}

function docComponents(doc: MdDoc): Components {
  return {
    img: ({ node: _node, src, alt, ...props }) => {
      const path = typeof src === 'string' ? docPath(doc.path, src) : undefined
      if (path === null)
        return (
          <span className="md-out" title={t('图片位于工作区以外，无法显示')}>
            {alt}
          </span>
        )
      return <img {...props} src={path ? doc.raw(path) : src} alt={alt} loading="lazy" />
    },
    a: ({ node: _node, href, children, ...props }) => {
      if (href?.startsWith('#'))
        return (
          <a
            {...props}
            href={href}
            onClick={(e) => {
              e.preventDefault()
              jumpTo(e.currentTarget.closest('.md'), unhash(href))
            }}
          >
            {children}
          </a>
        )
      const path = href ? docPath(doc.path, href) : undefined
      if (path === undefined)
        return (
          <a {...props} href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      if (path === null)
        return (
          <span className="md-out" title={t('链接指向工作区以外，无法打开')}>
            {children}
          </span>
        )
      return (
        <a
          {...props}
          href={doc.raw(path)}
          onClick={(e) => {
            e.preventDefault()
            doc.open(path)
          }}
        >
          {children}
        </a>
      )
    },
  }
}

const baseComponents: Components = {
  pre: ({ children }) => {
    const { text, language, closed } = fenced(children)
    return closed && language ? (
      <RichBlock language={language} text={text} onCopyError={copyFailed} />
    ) : (
      <CodeBlock code={text} language={language} onCopyError={copyFailed} />
    )
  },
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

/**
 * Bot reply rendering: GFM (tables, task lists) + Pane code blocks with copy, UI blocks (charts, buttons…) as
 * components; `botId` makes file names in code clickable; `doc` reads it as a workspace file (heading anchors,
 * relative images and links). Wrap in RichMessage to let blocks act on the reply.
 */
export const Markdown = memo(function Markdown({
  text,
  botId,
  doc,
}: {
  text: string
  botId?: string
  doc?: MdDoc
}) {
  const names = useContext(MentionNames)
  const plugins = useMemo(
    () => [
      ...remarkPlugins,
      ...(names ? [remarkMentions(names)] : []),
      ...(botId ? [remarkFileRefs] : []),
      ...(doc ? [remarkSlugs] : []),
    ],
    [names, botId, doc],
  )
  const components = useMemo(
    () =>
      ({
        ...baseComponents,
        ...(doc ? docComponents(doc) : {}),
        'file-ref': (p: FileRefProps & { children?: ReactNode }) => <FileRef {...p} botId={botId ?? ''} />,
      }) as Components,
    [botId, doc],
  )
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
