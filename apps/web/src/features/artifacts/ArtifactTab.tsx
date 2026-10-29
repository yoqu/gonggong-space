import type { ArtifactVersionDto } from '@gonggong/protocol'
import { useMemo, useState } from 'react'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { ago } from '../../lib/time'
import { Button, EmptyState, Icon, MenuButton, Skeleton, Spinner, Tag, Tooltip } from '../../ui'
import { openUrl } from '../previews/store'
import type { TabMeta, TabProps } from '../workbench/types'
import { Canvas } from './Canvas'
import { layoutNodes } from './geometry'
import { loadArtifact, restoreVersion, useArtifact, useArtifactEntry, useArtifactPreview } from './store'
import './artifacts.css'

const SOURCE: Record<ArtifactVersionDto['source'], string> = {
  run: t('AI 生成'),
  edit: t('手动编辑'),
  local: t('本机改动'),
}

const versionNote = (v: ArtifactVersionDto) =>
  [SOURCE[v.source], v.authorName, ago(v.createdAt), v.stale ? t('候选') : ''].filter(Boolean).join(' · ')

/**
 * A hosted artifact in the workbench (docs/plan/原型编辑器-Stitch对标-开发计划.md, B3): its versions on top, its screens on
 * the canvas. The server hosts it, so it opens whether or not the bot's machine is online.
 */
export function ArtifactTab({ tab }: TabProps<'artifact'>) {
  const entry = useArtifact(tab.artifactId)
  const a = entry?.artifact
  /** A past version looked at, read-only; null = the head. */
  const [viewing, setViewing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const head = a?.headVersionId ?? null
  const shown = viewing ?? head
  const { preview, error: previewError } = useArtifactPreview(tab.artifactId, viewing, !!head)
  const layout = useMemo(() => (a ? layoutNodes(a) : null), [a])

  // Undo and redo step through the versions that were heads (candidates never were).
  const line = (entry?.versions ?? []).filter((v) => !v.stale || v.id === head)
  const at = line.findIndex((v) => v.id === head)
  const step = (to: ArtifactVersionDto | undefined) =>
    to && !viewing && !a?.running && !busy
      ? async () => {
          setBusy(true)
          await attempt(() => restoreVersion(tab.artifactId, to.id))
          setBusy(false)
        }
      : null
  const undo = step(at > 0 ? line[at - 1] : undefined)
  const redo = step(at >= 0 ? line[at + 1] : undefined)
  const adopt = async () => {
    if (!viewing) return
    setBusy(true)
    await attempt(async () => {
      await restoreVersion(tab.artifactId, viewing)
      setViewing(null)
    })
    setBusy(false)
  }

  if (!entry) return <Spinner />
  if (!a)
    return (
      <EmptyState
        icon="grid"
        title={t('产物已删除或无法读取')}
        description={entry.error}
        action={<Button onClick={() => void loadArtifact(tab.artifactId)}>{t('重试')}</Button>}
      />
    )

  const versions = [...entry.versions].reverse()
  const current = entry.versions.find((v) => v.id === shown)
  const entryScreen = a.manifest?.entry
  const present = () => {
    if (preview && entryScreen)
      window.open(`${openUrl(preview.previewId, '/')}#play:${entryScreen}`, '_blank', 'noopener')
  }

  return (
    <div className="art">
      <header className="art-bar">
        <Icon name="grid" size={15} className="art-bar__icon" />
        <h2 className="art-bar__title" title={a.title}>
          {a.title}
        </h2>
        {versions.length ? (
          <MenuButton
            className="ui-btn ui-btn--plain ui-btn--small art-bar__version"
            aria-label={t('版本')}
            items={versions.map((v) => ({
              label: v.id === head ? t('v{n}（当前）', { n: v.n }) : `v${v.n}`,
              value: v.id,
              shortcut: versionNote(v),
              checked: v.id === shown,
            }))}
            onSelect={(id) => setViewing(id === head ? null : id)}
          >
            {current ? `v${current.n}` : t('版本')}
            <Icon name="chevron-down" size={10} weight={2} />
          </MenuButton>
        ) : null}
        {a.running ? (
          <Tag tone="blue" icon={<Spinner size={11} />}>
            {t('生成中')}
          </Tag>
        ) : null}
        {current?.issues.length ? (
          <Tag tone="orange" icon="warning">
            {t('{n} 项规范问题', { n: current.issues.length })}
          </Tag>
        ) : null}
        <span className="art-bar__fill" />
        <Button
          size="small"
          variant="plain"
          icon="play"
          disabled={!preview || !entryScreen}
          onClick={present}
        >
          {t('演示')}
        </Button>
        <Tooltip content={t('即将支持')}>
          <Button size="small" icon="download" disabled>
            {t('导出')}
          </Button>
        </Tooltip>
        <Tooltip content={t('即将支持')}>
          <Button size="small" variant="primary" icon="share" disabled>
            {t('分享')}
          </Button>
        </Tooltip>
      </header>
      {viewing && current ? (
        <div className="art-past" role="status">
          <Icon name="clock" size={14} />
          <span>{t('正在查看 v{n}（只读）', { n: current.n })}</span>
          <Button size="small" variant="plain" onClick={() => setViewing(null)}>
            {t('回到当前版本')}
          </Button>
          <Button size="small" disabled={busy || a.running} onClick={() => void adopt()}>
            {t('设为当前版本')}
          </Button>
        </div>
      ) : null}
      {!head || !layout ? (
        <Generating />
      ) : previewError ? (
        <EmptyState icon="grid" title={t('打不开产物预览')} description={previewError} />
      ) : (
        <Canvas
          nodes={layout.nodes}
          device={layout.device}
          previewId={preview?.previewId ?? null}
          versionKey={shown ?? ''}
          undo={undo}
          redo={redo}
        />
      )}
    </div>
  )
}

/** Before the first version: screen-shaped placeholders on the canvas. */
function Generating() {
  return (
    <div className="art-canvas art-canvas--empty">
      <div className="art-plane">
        <div className="art-wait">
          <div className="art-wait__screens">
            <Skeleton variant="block" count={1} width={180} height={360} />
            <Skeleton variant="block" count={1} width={180} height={360} />
            <Skeleton variant="block" count={1} width={180} height={360} />
          </div>
          <div className="art-wait__note">
            <Spinner size={14} />
            {t('正在生成，第一版完成后显示在这里')}
          </div>
        </div>
      </div>
    </div>
  )
}

export function useArtifactTabMeta(tab: TabProps<'artifact'>['tab']): TabMeta {
  const a = useArtifactEntry(tab.artifactId)?.artifact
  return {
    icon: 'grid',
    title: a?.title || tab.title || t('产物'),
    ...(a?.running || (a && !a.headVersionId) ? { status: 'running' as const } : {}),
  }
}
