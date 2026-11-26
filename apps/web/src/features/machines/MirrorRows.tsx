import type { Mirror } from '@gonggong/protocol'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import { t } from '../../i18n'
import { GroupRow, PopUpButton, TextField } from '../../ui'
import './machines.css'

const MIRRORS: { value: Mirror['kind']; label: string }[] = [
  { value: 'npmmirror', label: t('淘宝镜像（npmmirror）') },
  { value: 'official', label: t('官方源') },
  { value: 'custom', label: t('自定义') },
]

/**
 * 镜像源 of Node.js and the agent CLIs, saved as it changes; a custom one once both addresses are in. Shared by the
 * machine page and the desktop app's settings (rows of a GroupBox).
 */
export function MirrorRows({
  mirror,
  status,
  onSave,
}: {
  mirror: Mirror
  status: ReactNode
  onSave: (m: Mirror) => Promise<unknown> | undefined
}) {
  const [kind, setKind] = useState(mirror.kind)
  const [registry, setRegistry] = useState(mirror.kind === 'custom' ? mirror.registry : '')
  const [node, setNode] = useState(mirror.kind === 'custom' ? mirror.node : '')
  const sent = useRef(mirror.kind === 'custom' ? JSON.stringify(mirror) : '')
  const inflight = useRef<string | null>(null)
  const queued = useRef<{ key: string; value: Mirror } | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const missing =
    registry.trim() && !node.trim()
      ? t('还需要填写 Node.js 下载地址')
      : node.trim() && !registry.trim()
        ? t('还需要填写 npm registry')
        : null
  const customDraft =
    kind === 'custom' ? JSON.stringify({ kind: 'custom', registry: registry.trim(), node: node.trim() }) : ''
  const dirty =
    kind === 'custom' && (registry.trim() !== '' || node.trim() !== '') && customDraft !== sent.current
  // A custom mirror needs both addresses; serialize pending saves and commit `sent` only after success.
  const flush = (key: string, m: Mirror) => {
    inflight.current = key
    void Promise.resolve(onSaveRef.current(m))
      .then((ok) => {
        if (ok !== false) sent.current = key
      })
      .catch(() => {})
      .finally(() => {
        if (inflight.current === key) inflight.current = null
        const next = queued.current
        queued.current = null
        if (next && next.key !== sent.current) flush(next.key, next.value)
      })
  }
  const commit = {
    onBlur: () => {
      const m: Mirror = { kind: 'custom', registry: registry.trim(), node: node.trim() }
      if (!m.registry || !m.node) return
      const key = JSON.stringify(m)
      const effective = queued.current?.key ?? inflight.current ?? sent.current
      if (key === effective) return
      if (inflight.current !== null) {
        queued.current = key === inflight.current ? null : { key, value: m }
        return
      }
      flush(key, m)
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit.onBlur()
    },
  }
  return (
    <>
      <GroupRow label={t('镜像源')} description={t('安装、升级 Node.js 与 Agent 工具时从这里下载')}>
        <span className="mx-inline" data-dirty={dirty ? 'true' : undefined}>
          {status}
          <PopUpButton
            aria-label={t('镜像源')}
            options={MIRRORS}
            value={kind}
            onChange={(k) => {
              setKind(k)
              if (k !== 'custom') {
                queued.current = null
                void onSave({ kind: k })
              }
            }}
          />
        </span>
      </GroupRow>
      {kind === 'custom' ? (
        <>
          <GroupRow label="npm registry">
            <TextField
              aria-label="npm registry"
              className="mx-mirror-field"
              placeholder="https://registry.example.com"
              value={registry}
              onChange={(e) => setRegistry(e.target.value)}
              {...commit}
            />
          </GroupRow>
          <GroupRow label={t('Node.js 下载地址')} description={t('index.json 所在的目录')}>
            <TextField
              aria-label={t('Node.js 下载地址')}
              className="mx-mirror-field"
              placeholder="https://example.com/mirrors/node"
              value={node}
              onChange={(e) => setNode(e.target.value)}
              {...commit}
            />
          </GroupRow>
          {missing ? <div className="mx-row mx-sub mx-warn">{missing}</div> : null}
        </>
      ) : null}
    </>
  )
}
