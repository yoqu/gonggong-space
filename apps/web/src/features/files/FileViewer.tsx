import { FILE_TEXT_MAX_BYTES, type FileTextDto, type GitBlameDto } from '@gonggong/protocol'
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type LineRange, useWorkbench } from '../../app/workbench'
import { useWorkspace } from '../../app/workspace'
import { api, errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { cx } from '../../lib/cx'
import { ago, fullTime } from '../../lib/time'
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
  type Lang,
  langOf,
  Popover,
  SegmentedControl,
  Spinner,
  Tabs,
  Tokens,
  useHighlight,
} from '../../ui'
import { fmtSize } from '../attachments/api'
import { citeInChat } from '../chat/cite'
import { Markdown } from '../chat/Markdown'
import { revertChange, useGitDiff } from '../diff/GitFileDiff'
import { type LineMark, lineMarks } from '../diff/hunk'
import { useGitStamp } from '../diff/useWorkspaceDiff'
import { gitBase, gitUrls } from '../git/api'
import { gitCommands } from '../git/commands'
import './files.css'
import { t } from '../../i18n'

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

/** Memoized: a file can hold up to 2 MB of text, split, highlighted and drawn line by line. */
/** One line's annotation: its commit (null = not committed yet), whether it starts a run, the run's band. */
interface BlameLine {
  hash: string
  label: string
  title: string
  first: boolean
  band: number
}

/** Git blame per line: runs of lines from one commit, labelled on their first line, banded alternately. */
function blameLines(b: GitBlameDto): BlameLine[] {
  const commits = new Map(b.commits.map((c) => [c.hash, c]))
  const out: BlameLine[] = []
  b.ranges.forEach((r, band) => {
    const c = commits.get(r.commit)
    const label = c ? `${c.shortHash} ${c.author} ${ago(c.at)}` : t('未提交')
    const title = c ? `${c.subject}\n${c.author} · ${fullTime(c.at)}\n${c.hash}` : t('尚未提交的改动')
    for (let i = 0; i < r.count; i++)
      out[r.start - 1 + i] = { hash: r.commit, label, title, first: i === 0, band }
  })
  return out
}

/** The work tree's changes against HEAD, marked beside the line numbers as in IDEA's editor; each rolls back alone. */
export interface FileChanges {
  marks: LineMark[]
  revert: (m: LineMark) => void
  showDiff: () => void
}

function markLabel(m: LineMark) {
  if (m.kind === 'deleted') return t('删除：{n} 行', { n: m.old.length })
  const lines = { range: m.to > m.from ? `${m.from}–${m.to}` : `${m.from}`, n: m.to - m.from + 1 }
  return m.kind === 'added' ? t('新增：第 {range} 行', lines) : t('修改：第 {range} 行', lines)
}

/**
 * A line's place in the change markers' column: the marker of the change starting there (a deletion past the last of
 * the `count` lines is drawn under it), which opens what the change replaced, to roll it back or see the diff.
 */
function ChangeMark({ mark, count, changes }: { mark?: LineMark; count: number; changes: FileChanges }) {
  if (!mark) return <span className="pv-line__mark" />
  const label = markLabel(mark)
  return (
    <span
      className="pv-line__mark"
      data-kind={mark.kind}
      data-end={mark.from > count || undefined}
      style={{ '--lines': mark.to - mark.from + 1 } as CSSProperties}
    >
      <Popover
        className="pv-mark"
        portal
        aria-label={label}
        trigger={<button type="button" className="pv-mark__bar" aria-label={label} title={label} />}
      >
        {(close) => (
          <div className="pv-change">
            {mark.old.length ? <pre className="pv-change__old">{mark.old.join('\n')}</pre> : null}
            <div className="pv-change__actions">
              <Button
                size="small"
                icon="undo"
                onClick={() => {
                  close()
                  changes.revert(mark)
                }}
              >
                {t('回滚')}
              </Button>
              <Button
                size="small"
                variant="plain"
                icon="doc-text"
                onClick={() => {
                  close()
                  changes.showDiff()
                }}
              >
                {t('显示差异')}
              </Button>
            </div>
          </div>
        )}
      </Popover>
    </span>
  )
}

const Lines = memo(function Lines({
  text,
  colored,
  lang,
  line,
  blame,
  onCommit,
  changes,
}: {
  text: string
  colored: boolean
  lang: Lang | null
  line?: LineRange
  blame?: BlameLine[]
  onCommit?: (hash: string) => void
  changes?: FileChanges
}) {
  const { count, shown, code } = useMemo(() => {
    const lines = text.replace(/\n$/, '').split('\n')
    const shown = lines.slice(0, LINES_MAX)
    return { count: lines.length, shown, code: shown.join('\n') }
  }, [text])
  // Each change by the line it starts on; a deletion at the end of the file goes under the last line.
  const marks = useMemo(
    () => new Map(changes?.marks.map((m) => [Math.min(m.from, count), m] as const)),
    [changes, count],
  )
  const tokens = useHighlight(code, lang)
  const first = useRef<HTMLDivElement>(null)
  const from = line?.from
  const to = line?.to
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new range scrolls again, the ref is read on purpose
  useEffect(() => {
    first.current?.scrollIntoView({ block: 'center' })
  }, [from, to])
  return (
    <>
      <div className="pv-lines">
        {shown.map((l, i) => {
          const lv = colored ? level(l) : null
          const lineTokens = tokens?.[i]
          const hit = from !== undefined && to !== undefined && i + 1 >= from && i + 1 <= to
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
              key={i}
              ref={hit && i + 1 === from ? first : undefined}
              className={hit ? 'pv-line pv-line--hit' : 'pv-line'}
            >
              {blame ? <BlameCell b={blame[i]} onCommit={onCommit} /> : null}
              <span className="pv-line__n">{i + 1}</span>
              {changes ? <ChangeMark mark={marks.get(i + 1)} count={count} changes={changes} /> : null}
              <span className={lv ? `pv-line__t pv-line--${lv}` : 'pv-line__t'}>
                {lineTokens?.length ? <Tokens tokens={lineTokens} /> : l || ' '}
              </span>
            </div>
          )
        })}
      </div>
      {count > shown.length ? (
        <div className="fv__note">
          {t('仅显示前 {max} 行，共 {n} 行，完整内容请下载', { max: LINES_MAX, n: count })}
        </div>
      ) : null}
    </>
  )
})

function BlameCell({ b, onCommit }: { b: BlameLine | undefined; onCommit?: (hash: string) => void }) {
  if (!b) return <span className="pv-line__blame" />
  return (
    <span className="pv-line__blame" data-band={b.band % 2} data-mine={!b.hash || undefined} title={b.title}>
      {b.first ? (
        b.hash ? (
          <button type="button" className="pv-blame__btn" onClick={() => onCommit?.(b.hash)}>
            {b.label}
          </button>
        ) : (
          b.label
        )
      ) : null}
    </span>
  )
}

/** Git for a bot's file: who changed each line (IDEA's Annotate) and the file's history. */
export interface FileGit {
  blame: () => Promise<GitBlameDto>
  onCommit: (hash: string) => void
  onHistory: () => void
}

function Download({ url, name, message }: { url?: string; name: string; message: string }) {
  return (
    <div className="fv__none">
      <span>{message}</span>
      {url ? (
        <a className="ui-btn ui-btn--small" href={url} download={name}>
          {t('下载')}
        </a>
      ) : null}
    </div>
  )
}

export interface FileViewerProps {
  name: string
  /** Copied by 复制路径; relative to the workspace root. */
  path: string
  /** The bytes: media source and download link; absent for a version read from git (text only). */
  url?: string
  kind: ViewKind
  /** Text content for the textual kinds; must be stable across renders. */
  read: () => Promise<TextRead>
  /** Extra facts shown under the content (attachments). */
  details?: [string, string][]
  /** Lines to highlight and scroll to; a line range only means something in the source view. */
  line?: LineRange
  onOpenTab?: () => void
  onCite?: () => void
  /** A bot's file in a repo: annotate and history in the bar. */
  git?: FileGit
  /** Shows the annotations, on opening and anew whenever it changes (IDEA's Annotate from elsewhere). */
  annotate?: number
  /** Reads the text again in place whenever it changes (the work tree did). */
  stamp?: string
  changes?: FileChanges
}

/** One file by type (design §4.6): shared by the files tab, file tabs and attachments. */
export function FileViewer({
  name,
  path,
  url,
  kind,
  read,
  details,
  line,
  onOpenTab,
  onCite,
  git,
  annotate: annotateAsked,
  stamp,
  changes,
}: FileViewerProps) {
  const textual = TEXTUAL.includes(kind)
  const [annotate, setAnnotate] = useState<{ lines: BlameLine[] | null; error: string | null } | null>(null)
  const showAnnotations = (g: FileGit) => {
    setAnnotate({ lines: null, error: null })
    g.blame().then(
      (b) => setAnnotate((a) => a && { lines: blameLines(b), error: null }),
      (e: unknown) => setAnnotate((a) => a && { lines: null, error: errorText(e) }),
    )
  }
  const toggleAnnotate = () => {
    if (annotate || !git) return setAnnotate(null)
    showAnnotations(git)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new request shows them, even after they were hidden
  useEffect(() => {
    if (annotateAsked && git) showAnnotations(git)
  }, [annotateAsked, git])
  // Kept per read: a new stamp keeps the text shown until the fresh one arrives, another file starts empty.
  const [got, setGot] = useState<{
    read: FileViewerProps['read']
    text: TextRead | null
    error: string | null
  }>()
  const [attempt, setAttempt] = useState(0)
  const [md, setMd] = useState<'preview' | 'source'>(line || annotateAsked ? 'source' : 'preview')
  const [fit, setFit] = useState<'fit' | 'actual'>('fit')
  const [dim, setDim] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the read for 重试, a new stamp reads anew
  useEffect(() => {
    if (!textual) return
    let live = true
    read().then(
      (r) => live && setGot({ read, text: r, error: null }),
      (e: unknown) =>
        live && setGot({ read, text: null, error: e instanceof Error ? e.message : t('读取失败') }),
    )
    return () => {
      live = false
    }
  }, [textual, read, attempt, stamp])
  const mine = got?.read === read
  const text = mine ? got.text : null
  const error = mine ? got.error : null

  const copy = () => copyWithToast(path, t('已复制路径'))

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
        return <Download url={url} name={name} message={t('该类型暂不支持预览，可下载查看')} />
    }
    if (error)
      return (
        <EmptyState
          compact
          icon="warning"
          title={t('无法读取文件')}
          description={error}
          action={
            <Button
              onClick={() => {
                setGot(undefined)
                setAttempt((n) => n + 1)
              }}
            >
              {t('重试')}
            </Button>
          }
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
              ? t('二进制文件（{size}），无法预览，可下载查看', { size: fmtSize(text.size) })
              : t('文件过大（{size}，超过 {max}），可下载查看', {
                  size: fmtSize(text.size),
                  max: fmtSize(FILE_TEXT_MAX_BYTES),
                })
          }
        />
      )
    if (kind === 'md' && md === 'preview')
      return (
        <div className="fv__md">
          <Markdown text={text.text} />
        </div>
      )
    return (
      <>
        {annotate?.error ? (
          <div className="fv__note">{t('无法读取注解：{error}', { error: annotate.error })}</div>
        ) : null}
        <Lines
          text={text.text}
          colored={fileType(name) === 'text'}
          lang={langOf(name)}
          line={line}
          blame={annotate?.lines ?? undefined}
          onCommit={git?.onCommit}
          changes={changes}
        />
      </>
    )
  })()
  const source = textual && text?.text != null && !(kind === 'md' && md === 'preview')

  const rows =
    details && dim
      ? [...details, [kind === 'video' ? t('分辨率') : t('尺寸'), dim] as [string, string]]
      : details
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
              { value: 'preview', label: t('预览') },
              { value: 'source', label: t('源码') },
            ]}
          />
        ) : null}
        {kind === 'image' ? (
          <SegmentedControl
            size="small"
            aria-label={t('显示尺寸')}
            value={fit}
            onChange={setFit}
            items={[
              { value: 'fit', label: t('适应') },
              { value: 'actual', label: '1:1' },
            ]}
          />
        ) : null}
        {git && source ? (
          <Button
            size="small"
            variant="plain"
            icon="person"
            aria-label={t('注解（Git Blame）')}
            aria-pressed={!!annotate}
            title={t('注解（Git Blame）')}
            onClick={toggleAnnotate}
          >
            {annotate && !annotate.lines && !annotate.error ? <Spinner size={12} /> : null}
          </Button>
        ) : null}
        {git ? (
          <Button
            size="small"
            variant="plain"
            icon="clock"
            aria-label={t('显示历史')}
            title={t('显示历史')}
            onClick={git.onHistory}
          />
        ) : null}
        <Button
          size="small"
          variant="plain"
          icon="copy"
          aria-label={t('复制路径')}
          title={t('复制路径')}
          onClick={copy}
        />
        {url ? (
          <a
            className="ui-btn ui-btn--small ui-btn--plain ui-btn--icon"
            href={url}
            download={name}
            aria-label={t('下载')}
            title={t('下载')}
          >
            <Icon name="download" size={14} />
          </a>
        ) : null}
        {onOpenTab ? (
          <Button
            size="small"
            variant="plain"
            icon="external"
            aria-label={t('在新标签页打开')}
            title={t('在新标签页打开')}
            onClick={onOpenTab}
          />
        ) : null}
        {onCite ? (
          <Button
            size="small"
            variant="plain"
            icon="at"
            aria-label={t('在聊天中引用')}
            title={t('在聊天中引用')}
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

/**
 * A file of a bot's workspace in the current group, read through the files routes; `rev` (a branch or commit)
 * reads that version through the git routes, which serve text only.
 */
export function BotFileViewer({
  botId,
  path,
  line,
  rev,
  annotate,
  onOpenTab,
}: {
  botId: string
  path: string
  line?: LineRange
  rev?: string | null
  annotate?: number
  onOpenTab?: () => void
}) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const status = useWorkspace((s) => s.botStates[groupId]?.[botId]?.git ?? null)
  const stamp = useGitStamp(groupId, botId)
  const base = `/groups/${groupId}/bots/${botId}`
  const query = rev
    ? `?ref=${encodeURIComponent(rev)}&path=${encodeURIComponent(path)}`
    : `?path=${encodeURIComponent(path)}`
  const text = `${base}/${rev ? 'git' : 'files'}/text${query}`
  const read = useCallback(() => api.get<FileTextDto>(text), [text])
  const kind = viewKind(path)
  // The repo holding the file: the deepest sub-repo it sits in, else the root (when that is one).
  const sub = status?.repos
    .filter((r) => r.kind !== 'extra' && path.startsWith(`${r.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  const inRepo = !!status && (!!sub || status.branch != null || status.head != null)
  const repo = sub?.path ?? null
  const rel = sub ? path.slice(sub.path.length + 1) : path
  const git = useMemo<FileGit | undefined>(() => {
    if (!inRepo) return undefined
    const target = { groupId, botId, repo }
    return {
      blame: () => api.get<GitBlameDto>(gitUrls.blame(gitBase(groupId, botId), rel, rev ?? null, repo)),
      onCommit: (hash) => gitCommands(target).openLog({ commit: hash, ref: rev ?? null }),
      onHistory: () => gitCommands(target).openLog({ path: rel, ref: rev ?? null }),
    }
  }, [inRepo, groupId, botId, repo, rel, rev])
  // The work tree's file against HEAD, with git's three lines of context: a change's patch needs them to roll back.
  const work = !rev && inRepo && TEXTUAL.includes(kind)
  const diff = useGitDiff(
    work ? `${gitUrls.diff(gitBase(groupId, botId), 'HEAD', null, rel, repo)}&context=3` : null,
    stamp,
  )
  const changes = useMemo<FileChanges | undefined>(() => {
    const file = diff?.files[0]
    // A file new to git has nothing to roll back to; a cut patch may end inside a change.
    if (!file || diff.truncated || file.status !== 'modified' || file.binary) return undefined
    const target = { groupId, botId, repo }
    return {
      marks: lineMarks(file),
      revert: (m) => void revertChange(target, rel, m.patch),
      showDiff: () => gitCommands(target).openChange(rel),
    }
  }, [diff, groupId, botId, repo, rel])
  return (
    <FileViewer
      name={baseName(path)}
      path={path}
      url={rev ? undefined : `/api${base}/files/raw${query}`}
      kind={rev && !TEXTUAL.includes(kind) ? 'unknown' : kind}
      read={read}
      line={line}
      onOpenTab={onOpenTab}
      onCite={() => citeInChat(groupId, `@${path}`)}
      git={git}
      annotate={annotate}
      stamp={rev ? undefined : stamp}
      changes={changes}
    />
  )
}
