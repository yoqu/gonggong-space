import type { ArtifactVersionDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useWorkbench } from '../../app/workbench'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { ago } from '../../lib/time'
import {
  Button,
  ConfirmActionDialog,
  EmptyState,
  Icon,
  MenuButton,
  Presence,
  Skeleton,
  Spinner,
  toast,
} from '../../ui'
import type { TabMeta, TabProps } from '../workbench/types'
import { useGroupBots } from './actions'
import { Canvas, type CanvasRequest } from './Canvas'
import { useDesignSystem } from './DesignSystemPanel'
import { downloadUrl, exportZipUrl } from './ExportPanel'
import { IssuesButton } from './IssuesButton'
import { PrototypeEditor } from './PrototypeEditor'
import { ShareDialog } from './share'
import {
  archiveArtifact,
  artifactFileUrl,
  duplicateArtifact,
  editArtifact,
  loadArtifact,
  openArtifact,
  readArtifactFile,
  renameArtifact,
  restoreVersion,
  setFavorites,
  useArtifact,
  useArtifactEntry,
  useArtifactFocus,
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
  [
    SOURCE[v.source],
    v.authorName,
    ago(v.createdAt),
    v.stale ? t('候选') : '',
    v.thumbnailStale ? t('缩略图为旧版本') : '',
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * A hosted artifact in the workbench (docs/plan/原型编辑器-Stitch对标-开发计划.md, B3): its versions on top, its screens on
 * the canvas. The server hosts it, so it opens whether or not the bot's machine is online.
 */
const PROJECT = {
  rename: 'rename',
  duplicate: 'duplicate',
  download: 'download',
  commands: 'commands',
  shortcuts: 'shortcuts',
  archive: 'archive',
} as const

export function ArtifactTab({ tab, tabKey }: TabProps<'artifact'>) {
  const entry = useArtifact(tab.artifactId)
  const a = entry?.artifact
  /** A past version looked at, read-only; null = the head. */
  const [viewing, setViewing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The prototype editor, on the screen it opened on; null: the canvas. */
  const [proto, setProto] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [request, setRequest] = useState<CanvasRequest | null>(null)
  const ask = (what: CanvasRequest['what']) => setRequest((r) => ({ what, n: (r?.n ?? 0) + 1 }))
  const [renaming, setRenaming] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const groupBots = useGroupBots(a?.groupId ?? '')
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

  // A focus request on a past version (a run card's 在画布中查看) shows that version; the canvas then focuses.
  const focusAsk = useArtifactFocus(tab.artifactId)
  useEffect(() => {
    if (!focusAsk || !head) return
    setProto(null)
    const want = focusAsk.versionId && focusAsk.versionId !== head ? focusAsk.versionId : null
    if (focusAsk.versionId || viewing) setViewing(want)
  }, [focusAsk, head, viewing])

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

  const projectAction = async (value: string) => {
    if (value === PROJECT.rename) return setRenaming(true)
    if (value === PROJECT.commands) return ask('commands')
    if (value === PROJECT.shortcuts) return ask('shortcuts')
    if (value === PROJECT.archive) return setArchiving(true)
    if (value === PROJECT.download) return head ? downloadUrl(exportZipUrl(a.id, head)) : undefined
    if (value === PROJECT.duplicate)
      await attempt(async () => {
        const copy = await duplicateArtifact(a.id)
        toast({ type: 'success', message: t('已创建副本「{title}」', { title: copy.title }) })
        openArtifact(copy.id, copy.title)
      })
  }
  const rename = (next: string | null) => {
    setRenaming(false)
    if (next && next !== a.title) void attempt(() => renameArtifact(a.id, next))
  }

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
        <MenuButton
          className="ui-btn ui-btn--plain ui-btn--small art-bar__menu"
          aria-label={t('产物菜单')}
          items={[
            { label: t('重命名'), value: PROJECT.rename },
            { label: t('创建副本'), value: PROJECT.duplicate },
            { label: t('下载 .zip'), value: PROJECT.download, disabled: !head },
            { separator: true },
            { label: t('命令菜单'), value: PROJECT.commands, shortcut: '⌘K', disabled: !head },
            { label: t('快捷键'), value: PROJECT.shortcuts, shortcut: '?', disabled: !head },
            { separator: true },
            { label: t('删除产物'), value: PROJECT.archive, destructive: true },
          ]}
          onSelect={(v) => void projectAction(v)}
        >
          <Icon name="grid" size={15} className="art-bar__icon" />
          <Icon name="chevron-down" size={10} weight={2} />
        </MenuButton>
        {renaming ? (
          <TitleField title={a.title} onDone={rename} />
        ) : (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a shortcut; the menu renames from the keyboard
          <h2 className="art-bar__title" title={a.title} onDoubleClick={() => setRenaming(true)}>
            {a.title}
          </h2>
        )}
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
          <IssuesButton
            artifactId={a.id}
            versionId={current.id}
            issues={current.issues}
            manifest={shownManifest}
            bot={groupBots.find((b) => b.id === a.botId) ?? groupBots[0] ?? null}
            readOnly={readOnly}
          />
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
        <Button size="small" icon="download" disabled={!head} onClick={() => ask('export')}>
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
      {!a.running && a.queued ? (
        <div className="art-queued" role="status" data-testid="art-queued">
          <i className="art-queued__dot" aria-hidden="true" />
          <span>
            {t('@{name} 离线，{n} 个指令排队中，上线后自动执行', {
              name: groupBots.find((b) => b.id === a.botId)?.name ?? 'Bot',
              n: Math.max(1, a.queuedRunCount),
            })}
          </span>
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
          fileUrl={(file) => artifactFileUrl(tab.artifactId, file, shown ?? head)}
          screenThumbs={detail?.id === shown ? (detail.screenThumbs ?? []) : []}
          dir={a.dir}
          designMd={design.md}
          designPanel={design.panel}
          guardDesign={design.guard}
          request={request}
          versions={entry.versions}
          onViewVersion={(id) => setViewing(id === head ? null : id)}
          onPrototypeAsked={() => {
            awaitProto.current = a.running ? 'running' : 'asked'
          }}
        />
      )}
      {design.dialog}
      {shareDialog}
      <Presence>
        {archiving ? (
          <ConfirmActionDialog
            title={t('删除产物「{title}」？', { title: a.title })}
            message={t('从群里移除，群成员不再看到它')}
            consequences={[t('文件和版本保留，可以恢复')]}
            label={t('删除')}
            done={t('已删除')}
            run={() => archiveArtifact(a.id)}
            onDone={() => useWorkbench.getState().closeTab(tabKey)}
            onClose={() => setArchiving(false)}
          />
        ) : null}
      </Presence>
    </div>
  )
}

/** The artifact's title, renamed in place: Enter saves, Esc or leaving cancels. */
function TitleField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(title)
  const done = useRef(false)
  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      className="ui-input art-bar__rename"
      aria-label={t('产物名称')}
      value={value}
      maxLength={80}
      // biome-ignore lint/a11y/noAutofocus: opened on purpose by Rename
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(value.trim() || null)
        else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null)
        }
      }}
      onBlur={() => finish(null)}
    />
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
