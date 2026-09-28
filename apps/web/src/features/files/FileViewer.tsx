import { FILE_TEXT_MAX_BYTES, type FileTextDto } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { useWorkbench } from '../../app/workbench'
import { api } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { cx } from '../../lib/cx'
import {
  Button,
  EmptyState,
  FileIcon,
  type FileType,
  fileType,
  GroupBox,
  GroupRow,
  Icon,
  type IconName,
  SegmentedControl,
  Spinner,
  Tabs,
  toast,
} from '../../ui'
import { fmtSize } from '../attachments/api'
import { citeInChat } from '../chat/cite'
import { Markdown } from '../chat/Markdown'
import './files.css'

/** How the viewer shows a file (design §4.6); `unknown` is decided by what the text read reports. */
export type ViewKind = 'image' | 'video' | 'audio' | 'pdf' | 'md' | 'html' | 'text' | 'binary' | 'unknown'

export type TextRead = Pick<FileTextDto, 'text' | 'binary' | 'size'>

const BY_TYPE: Partial<Record<FileType, ViewKind>> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  md: 'md',
  code: 'text',
  text: 'text',
  other: 'unknown',
}

/** By extension: html shows its source, csv/tsv are text though their icon is a sheet. */
export function viewKind(name: string): ViewKind {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'csv' || ext === 'tsv') return 'text'
  return BY_TYPE[fileType(name)] ?? 'binary'
}

const ICON: Record<FileType, IconName> = {
  pdf: 'doc-text',
  word: 'doc-text',
  excel: 'sheet',
  ppt: 'slides',
  archive: 'archive',
  audio: 'speaker',
  image: 'image',
  video: 'video',
  md: 'doc-text',
  code: 'doc-code',
  text: 'doc-text',
  other: 'doc',
}
export const fileIconName = (name: string, mime?: string) => ICON[fileType(name, mime)]

export const baseName = (path: string) => path.split('/').pop() ?? path

/** A whole 2 MB file as line nodes is too heavy; the rest is a download away. */
const LINES_MAX = 5000
const TEXTUAL: ViewKind[] = ['md', 'html', 'text', 'unknown']

const level = (line: string) => (/ERROR|FAIL/.test(line) ? 'error' : /WARN/.test(line) ? 'warn' : null)

function Lines({ text, colored }: { text: string; colored: boolean }) {
  const lines = text.replace(/\n$/, '').split('\n')
  const shown = lines.slice(0, LINES_MAX)
  return (
    <>
      <div className="pv-lines">
        {shown.map((l, i) => {
          const lv = colored ? level(l) : null
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <div key={i} className="pv-line">
              <span className="pv-line__n">{i + 1}</span>
              <span className={lv ? `pv-line__t pv-line--${lv}` : 'pv-line__t'}>{l || ' '}</span>
            </div>
          )
        })}
      </div>
      {lines.length > shown.length ? (
        <div className="fv__note">{`仅显示前 ${LINES_MAX} 行，共 ${lines.length} 行，完整内容请下载`}</div>
      ) : null}
    </>
  )
}

function Download({ url, name, message }: { url: string; name: string; message: string }) {
  return (
    <div className="fv__none">
      <span>{message}</span>
      <a className="ui-btn ui-btn--small" href={url} download={name}>
        下载
      </a>
    </div>
  )
}

export interface FileViewerProps {
  name: string
  /** Copied by 复制路径; relative to the workspace root. */
  path: string
  /** The bytes: media source and download link. */
  url: string
  kind: ViewKind
  /** Text content for the textual kinds; must be stable across renders. */
  read: () => Promise<TextRead>
  /** Extra facts shown under the content (attachments). */
  details?: [string, string][]
  onOpenTab?: () => void
  onCite?: () => void
}

/** One file by type (design §4.6): shared by the files tab, file tabs and attachments. */
export function FileViewer({ name, path, url, kind, read, details, onOpenTab, onCite }: FileViewerProps) {
  const textual = TEXTUAL.includes(kind)
  const [text, setText] = useState<TextRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [md, setMd] = useState<'preview' | 'source'>('preview')
  const [fit, setFit] = useState<'fit' | 'actual'>('fit')
  const [dim, setDim] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read for 重试
  useEffect(() => {
    if (!textual) return
    let live = true
    setText(null)
    setError(null)
    read().then(
      (r) => live && setText(r),
      (e: unknown) => live && setError(e instanceof Error ? e.message : '读取失败'),
    )
    return () => {
      live = false
    }
  }, [textual, read, attempt])

  const copy = () =>
    copyText(path).then(
      () => toast({ type: 'success', message: '已复制路径' }),
      () => toast({ type: 'error', message: '复制失败' }),
    )

  const body = (() => {
    switch (kind) {
      case 'image':
        return (
          <div className="fv__media fv__media--checker">
            <img
              className={cx('fv-img', fit === 'fit' && 'fv-img--fit')}
              src={url}
              alt={name}
              onLoad={(e) => setDim(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
            />
          </div>
        )
      case 'video':
        return (
          <div className="fv__media">
            {/* biome-ignore lint/a11y/useMediaCaption: workspace and uploaded videos carry no caption track */}
            <video
              src={url}
              controls
              onLoadedMetadata={(e) => setDim(`${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`)}
            />
          </div>
        )
      case 'audio':
        return (
          <div className="fv__audio">
            {/* biome-ignore lint/a11y/useMediaCaption: workspace audio carries no caption track */}
            <audio src={url} controls />
          </div>
        )
      case 'pdf':
        return <iframe className="fv__pdf" title={name} src={url} />
      case 'binary':
        return <Download url={url} name={name} message="该类型暂不支持预览，可下载查看" />
    }
    if (error)
      return (
        <EmptyState
          compact
          icon="warning"
          title="无法读取文件"
          description={error}
          action={<Button onClick={() => setAttempt((n) => n + 1)}>重试</Button>}
        />
      )
    if (!text)
      return (
        <div className="fv__state">
          <Spinner />
        </div>
      )
    if (text.text === null)
      return (
        <Download
          url={url}
          name={name}
          message={
            text.binary
              ? `二进制文件（${fmtSize(text.size)}），无法预览，可下载查看`
              : `文件过大（${fmtSize(text.size)}，超过 ${fmtSize(FILE_TEXT_MAX_BYTES)}），可下载查看`
          }
        />
      )
    if (kind === 'md' && md === 'preview')
      return (
        <div className="fv__md">
          <Markdown text={text.text} />
        </div>
      )
    return <Lines text={text.text} colored={fileType(name) === 'text'} />
  })()

  const rows =
    details && dim ? [...details, [kind === 'video' ? '分辨率' : '尺寸', dim] as [string, string]] : details
  return (
    <div className="fv">
      <div className="fv__bar">
        <FileIcon name={name} size={16} />
        <span className="fv__name" title={path}>
          {name}
        </span>
        <span className="spacer" />
        {kind === 'md' && text?.text != null ? (
          <Tabs
            size="sm"
            value={md}
            onChange={setMd}
            items={[
              { value: 'preview', label: '预览' },
              { value: 'source', label: '源码' },
            ]}
          />
        ) : null}
        {kind === 'image' ? (
          <SegmentedControl
            size="small"
            aria-label="显示尺寸"
            value={fit}
            onChange={setFit}
            items={[
              { value: 'fit', label: '适应' },
              { value: 'actual', label: '1:1' },
            ]}
          />
        ) : null}
        <Button
          size="small"
          variant="plain"
          icon="copy"
          aria-label="复制路径"
          title="复制路径"
          onClick={copy}
        />
        <a
          className="ui-btn ui-btn--small ui-btn--plain ui-btn--icon"
          href={url}
          download={name}
          aria-label="下载"
          title="下载"
        >
          <Icon name="download" size={14} />
        </a>
        {onOpenTab ? (
          <Button
            size="small"
            variant="plain"
            icon="external"
            aria-label="在新标签页打开"
            title="在新标签页打开"
            onClick={onOpenTab}
          />
        ) : null}
        {onCite ? (
          <Button
            size="small"
            variant="plain"
            icon="at"
            aria-label="在聊天中引用"
            title="在聊天中引用"
            onClick={onCite}
          />
        ) : null}
      </div>
      <div className="fv__body">
        {body}
        {rows ? (
          <GroupBox>
            {rows.map(([k, v]) => (
              <GroupRow key={k} label={k}>
                <span className="fv__val">{v}</span>
              </GroupRow>
            ))}
          </GroupBox>
        ) : null}
      </div>
    </div>
  )
}

/** A file of a bot's workspace in the current group, read through the files routes. */
export function BotFileViewer({
  botId,
  path,
  onOpenTab,
}: {
  botId: string
  path: string
  onOpenTab?: () => void
}) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const base = `/groups/${groupId}/bots/${botId}/files`
  const query = `?path=${encodeURIComponent(path)}`
  const read = useCallback(() => api.get<FileTextDto>(`${base}/text${query}`), [base, query])
  return (
    <FileViewer
      name={baseName(path)}
      path={path}
      url={`/api${base}/raw${query}`}
      kind={viewKind(path)}
      read={read}
      onOpenTab={onOpenTab}
      onCite={() => citeInChat(groupId, `@${path}`)}
    />
  )
}
