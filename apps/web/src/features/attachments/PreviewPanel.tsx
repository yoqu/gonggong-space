import { useEffect, useState } from 'react'
import { Button, CloseButton, Spinner, Tabs, toast } from '../../ui'
import { Markdown } from '../chat/Markdown'
import { attachmentUrl, type FileKind, fmtSize, KIND_LABEL, kindOf, workspacePath } from './api'
import { KIND_ICON } from './MessageAttachments'
import { type PreviewTarget, usePreview } from './preview'
import './attachments.css'

/** Text previews fetch the whole file; bigger ones are download-only. */
const TEXT_MAX = 2 * 1024 * 1024
const LINES_MAX = 500
const TEXTUAL: FileKind[] = ['md', 'text', 'code']

const SEND_NOTE: Partial<Record<FileKind, string>> = {
  image: 'Claude Code 以 ACP 图片内容直接发送；Codex 仅落盘，按路径读取',
  video: '视频不直接发送，agent 按路径读取',
}

function useText(id: string, enabled: boolean) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    setText(null)
    fetch(attachmentUrl(id), { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
      .then(
        (t) => alive && setText(t),
        () => alive && toast({ type: 'error', message: '附件加载失败' }),
      )
    return () => {
      alive = false
    }
  }, [id, enabled])
  return text
}

const level = (line: string) => (/ERROR|FAIL/.test(line) ? 'error' : /WARN/.test(line) ? 'warn' : null)

function Lines({ lines, colored }: { lines: string[]; colored: boolean }) {
  return (
    <div className="pv-lines">
      {lines.map((l, i) => {
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
  )
}

/** Right-rail preview of a message attachment (prototype `pv`). */
export function PreviewPanel({ target }: { target: PreviewTarget }) {
  const { attachment: a, from } = target
  const close = usePreview((s) => s.close)
  const kind = kindOf(a)
  const textual = TEXTUAL.includes(kind) && a.size <= TEXT_MAX
  const text = useText(a.id, textual)
  const [tab, setTab] = useState<'preview' | 'source'>('preview')
  const [dim, setDim] = useState<string | null>(null)
  const Icon = KIND_ICON[kind]
  const url = attachmentUrl(a.id)
  const lines = text?.replace(/\n$/, '').split('\n') ?? []
  const shown = lines.slice(0, LINES_MAX)

  const rows: [string, string][] = [
    ['来源', from],
    ...(dim ? [[kind === 'video' ? '分辨率' : '尺寸', dim] as [string, string]] : []),
    ['大小', fmtSize(a.size)],
    ['位置', workspacePath(a)],
    SEND_NOTE[kind] ? ['发送给 bot', SEND_NOTE[kind]] : ['工作树', '已加入 .git/info/exclude，不进 git'],
  ]
  const copyPath = () =>
    navigator.clipboard
      .writeText(workspacePath(a))
      .then(() => toast({ type: 'success', message: '已复制路径' }))

  return (
    <div className="pv">
      <div className="pv__head">
        <div className="pv__title">
          <Icon size={14} />
          <span className="pv__name">{a.name}</span>
          <CloseButton onClick={close} />
        </div>
        <div className="pv__meta">{`${KIND_LABEL[kind]} · ${fmtSize(a.size)} · ${from}`}</div>
        <div className="pv__tools">
          <a className="ui-btn ui-btn--outline ui-btn--xs" href={url} download={a.name}>
            下载
          </a>
          <Button variant="ghost" size="xs" onClick={() => void copyPath()}>
            复制路径
          </Button>
          <span className="spacer" />
          {kind === 'md' ? (
            <Tabs
              size="sm"
              value={tab}
              onChange={setTab}
              items={[
                { value: 'preview', label: '预览' },
                { value: 'source', label: '源码' },
              ]}
            />
          ) : null}
        </div>
      </div>
      <div className="pv__body">
        {kind === 'image' ? (
          <div className="pv__media">
            <img
              src={url}
              alt={a.name}
              onLoad={(e) => setDim(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
            />
          </div>
        ) : kind === 'video' ? (
          <div className="pv__media">
            {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded videos carry no caption track */}
            <video
              src={url}
              controls
              onLoadedMetadata={(e) => setDim(`${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`)}
            />
          </div>
        ) : !textual ? (
          <div className="pv__none">该类型暂不支持预览，可下载查看</div>
        ) : text === null ? (
          <Spinner />
        ) : kind === 'md' && tab === 'preview' ? (
          <div className="pv__md">
            <Markdown text={text} />
          </div>
        ) : (
          <Lines lines={shown} colored={kind === 'text'} />
        )}
        {textual && kind === 'text' && text !== null ? (
          <div className="pv__note">{`预览前 ${shown.length} 行 · 完整文件 ${fmtSize(a.size)}`}</div>
        ) : null}
        <div className="pv__rows">
          {rows.map(([k, v]) => (
            <div key={k} className={k === '位置' ? 'pv__row pv__row--mono' : 'pv__row'}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
