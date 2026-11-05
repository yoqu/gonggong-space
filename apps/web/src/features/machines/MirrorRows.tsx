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
  onSave: (m: Mirror) => void
}) {
  const [kind, setKind] = useState(mirror.kind)
  const [registry, setRegistry] = useState(mirror.kind === 'custom' ? mirror.registry : '')
  const [node, setNode] = useState(mirror.kind === 'custom' ? mirror.node : '')
  const sent = useRef(mirror.kind === 'custom' ? JSON.stringify(mirror) : '')
  const missing =
    registry.trim() && !node.trim()
      ? t('还需要填写 Node.js 下载地址')
      : node.trim() && !registry.trim()
        ? t('还需要填写 npm registry')
        : null
  // A custom mirror needs both addresses; it is saved once they are in and differ from what was last sent.
  const commit = {
    onBlur: () => {
      const m: Mirror = { kind: 'custom', registry: registry.trim(), node: node.trim() }
      if (!m.registry || !m.node || JSON.stringify(m) === sent.current) return
      sent.current = JSON.stringify(m)
      onSave(m)
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit.onBlur()
    },
  }
  return (
    <>
      <GroupRow label={t('镜像源')} description={t('安装、升级 Node.js、Claude Code 与 Codex 时从这里下载')}>
        <span className="mx-inline">
          {status}
          <PopUpButton
            aria-label={t('镜像源')}
            options={MIRRORS}
            value={kind}
            onChange={(k) => {
              setKind(k)
              if (k !== 'custom') onSave({ kind: k })
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
