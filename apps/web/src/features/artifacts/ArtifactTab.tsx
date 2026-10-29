import type { ArtifactVersionDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { ago } from '../../lib/time'
import { Button, EmptyState, Icon, MenuButton, Presence, Skeleton, Spinner, Tag } from '../../ui'
import type { TabMeta, TabProps } from '../workbench/types'
import { Canvas } from './Canvas'
import { useDesignSystem } from './DesignSystemPanel'
import { PrototypeEditor } from './PrototypeEditor'
import { ShareDialog } from './share'
import {
  editArtifact,
  loadArtifact,
  readArtifactFile,
  restoreVersion,
  setFavorites,
  useArtifact,
  useArtifactEntry,
  useArtifactPreview,
  useVersionDetail,
} from './store'
import './artifacts.css'
import './prototype.css'

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
  /** The prototype editor, on the screen it opened on; null: the canvas. */
  const [proto, setProto] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [exportRequest, setExportRequest] = useState(0)
  const head = a?.headVersionId ?? null
  const shown = viewing ?? head
  const { preview, error: previewError } = useArtifactPreview(tab.artifactId, viewing, !!head)
  const { detail, tokens: tokensCss } = useVersionDetail(tab.artifactId, shown)
  const readOnly = !!viewing || !!a?.running || busy
  const design = useDesignSystem({
    artifactId: tab.artifactId,
    groupId: a?.groupId,
    versionId: shown,
    css: tokensCss,
    hasDesignMd: detail?.id === shown && !!detail?.files.some((f) => f.path === 'DESIGN.md'),
    readOnly,
    author: entry?.versions.findLast((v) => v.source === 'run')?.authorName ?? null,
  })

  // Instant Prototype opens the editor once the bot's run on it ends (Stitch: Generate Prototype → the editor).
  const awaitProto = useRef<'asked' | 'running' | null>(null)
  const running = !!a?.running
  useEffect(() => {
    if (running && awaitProto.current === 'asked') awaitProto.current = 'running'
    else if (!running && awaitProto.current === 'running') {
      awaitProto.current = null
      if (a?.manifest) setProto(a.manifest.entry)
    }
  }, [running, a?.manifest])

  // Undo and redo move the head to the server's targets (ArtifactDto.undoVersionId / redoVersionId).
  const step = (to: string | null | undefined) =>
    to && !readOnly
      ? async () => {
          setBusy(true)
          await attempt(() => restoreVersion(tab.artifactId, to))
          setBusy(false)
        }
      : null
  const undo = step(a?.undoVersionId)
  const redo = step(a?.redoVersionId)
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
  const shownManifest = viewing ? (detail?.id === viewing ? detail.manifest : null) : a.manifest
  const present = () => {
    if (shownManifest) setProto(shownManifest.entry)
  }
  const shareDialog = (
    <Presence>
      {sharing ? (
        <ShareDialog
          artifactId={a.id}
          groupId={a.groupId}
          botId={a.botId}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </Presence>
  )

  if (proto && shownManifest && head)
    return (
      <div className="art">
        <PrototypeEditor
          artifactId={a.id}
          groupId={a.groupId}
          botId={a.botId}
          title={a.title}
          manifest={shownManifest}
          preview={preview}
          versionKey={shown ?? ''}
          readOnly={readOnly}
          start={proto}
          onEdit={(ops) => editArtifact(tab.artifactId, head, ops)}
          onBack={() => setProto(null)}
          onShare={() => setSharing(true)}
        />
        {shareDialog}
      </div>
    )

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
          disabled={!preview || !shownManifest}
          onClick={present}
        >
          {t('演示')}
        </Button>
        <Button size="small" icon="download" disabled={!head} onClick={() => setExportRequest((n) => n + 1)}>
          {t('导出')}
        </Button>
        <Button size="small" variant="primary" icon="share" onClick={() => setSharing(true)}>
          {t('分享')}
        </Button>
      </header>
      {a.running ? (
        <div className="art-running" role="status">
          <Spinner size={13} />
          <span>{t('AI 正在修改')}</span>
          <small>{t('完成前画布只读')}</small>
        </div>
      ) : null}
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
      {!head ? (
        <Generating />
      ) : previewError ? (
        <EmptyState icon="grid" title={t('打不开产物预览')} description={previewError} />
      ) : (
        <Canvas
          artifactId={a.id}
          groupId={a.groupId}
          botId={a.botId}
          title={a.title}
          manifest={shownManifest}
          tokens={design.tokens}
          links={detail?.id === shown ? (detail.links ?? []) : []}
          favourites={a.favorites ?? []}
          preview={preview}
          versionKey={shown ?? ''}
          readOnly={readOnly}
          undo={undo}
          redo={redo}
          onEdit={(ops) => editArtifact(tab.artifactId, head, ops)}
          onFavourites={(ids) => void attempt(() => setFavorites(tab.artifactId, ids))}
          onPresent={present}
          readFile={(file) => readArtifactFile(tab.artifactId, file, shown ?? head)}
          designPanel={design.panel}
          guardDesign={design.guard}
          exportRequest={exportRequest}
          onPrototypeAsked={() => {
            awaitProto.current = a.running ? 'running' : 'asked'
          }}
        />
      )}
      {design.dialog}
      {shareDialog}
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
