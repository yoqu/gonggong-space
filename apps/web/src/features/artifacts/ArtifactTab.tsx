import type { ArtifactDto, ArtifactVersionDto } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { downloadUrl } from '../../lib/download'
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
import { ActivityNote } from './ActivityLayer'
import { useGroupBots } from './actions'
import { Canvas, type CanvasRequest } from './Canvas'
import { CanvasComposer } from './CanvasChat'
import { useFrontCanvasChat } from './chatRoot'
import { useDesignSystem } from './DesignSystemPanel'
import { exportZipUrl } from './ExportPanel'
import { useLeaveArtifact } from './host'
import { IssuesButton } from './IssuesButton'
import { MoveDialog } from './MoveDialog'
import { PageRail, useRail } from './PageRail'
import { PrototypeEditor } from './PrototypeEditor'
import { type RunnerStatus, runnerText } from './runner'
import { ShareDialog, useArtifactManager } from './share'
import { ArtifactShell } from './shell/ArtifactShell'
import {
  type ArtifactEntry,
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
import './art-bar-narrow.css'
import './prototype.css'

const SOURCE: Record<ArtifactVersionDto['source'], string> = {
  run: t('AI 生成'),
  edit: t('手动编辑'),
  local: t('本机改动'),
  host: t('托管上传'),
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
 * A hosted artifact in the workbench (docs/archive/2026-11/原型编辑器-Stitch对标-开发计划.md, B3): its versions on top, its screens on
 * the canvas. The server hosts it, so it opens whether or not the bot's machine is online.
 */
const PROJECT = {
  rename: 'rename',
  duplicate: 'duplicate',
  move: 'move',
  download: 'download',
  commands: 'commands',
  shortcuts: 'shortcuts',
  archive: 'archive',
} as const

export function ArtifactTab(props: TabProps<'artifact'>) {
  const entry = useArtifact(props.tab.artifactId)
  const a = entry?.artifact
  if (!entry) return <Spinner />
  if (!a)
    return (
      <EmptyState
        icon="grid"
        title={t('产物已删除或无法读取')}
        description={entry.error}
        action={<Button onClick={() => void loadArtifact(props.tab.artifactId)}>{t('重试')}</Button>}
      />
    )
  // Non-prototype artifacts (`site`, `slides`, `whiteboard`, `motion`) run in the unified Shell.
  const kind = a.kind ?? (a.site ? 'site' : 'prototype')
  if (kind !== 'prototype')
    return (
      <ArtifactShell
        artifact={a.kind ? a : { ...a, kind }}
        versions={entry.versions}
        tabKey={props.tabKey}
        active={props.active}
      />
    )
  return <PrototypeArtifactTab {...props} entry={entry} artifact={a} />
}

function PrototypeArtifactTab({
  tab,
  tabKey,
  active,
  entry,
  artifact: a,
}: TabProps<'artifact'> & { entry: ArtifactEntry; artifact: ArtifactDto }) {
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
  const [moving, setMoving] = useState(false)
  const manager = useArtifactManager(a?.groupId ?? '', a?.botId, a?.createdBy ?? null, a?.canManage)
  const leave = useLeaveArtifact(tabKey)
  const groupBots = useGroupBots(a?.groupId ?? '')
  const head = a?.headVersionId ?? null
  const shown = viewing ?? head
  // Before the first version the canvas's editing tools are off: nothing reads or edits against `base` then.
  const base = head ?? ''
  const { preview, error: previewError } = useArtifactPreview(tab.artifactId, viewing, !!head)
  const { detail, tokens: tokensCss } = useVersionDetail(tab.artifactId, shown)
  const readOnly = !!viewing || busy
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

  // A run's new head says who made it; the canvas marks the screens it changed (本版改动).
  const lastHead = useRef(head)
  useEffect(() => {
    const was = lastHead.current
    lastHead.current = head
    const h = a?.head
    if (!was || h?.id !== head || h.parentVersionId !== was || h.source !== 'run') return
    toast({
      type: 'info',
      message: t('{name} 更新到 v{n}，改动的屏已标出', { name: h.authorName ?? 'AI', n: h.n }),
    })
  }, [head, a?.head])

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

  const rail = useRail()
  const isSite = !!a.site
  const siteFrame = useRef<HTMLIFrameElement>(null)
  // In front, the canvas has its own composer, talking to its AI 对话 and never to the group.
  const chatRoot = useFrontCanvasChat(
    a.groupId,
    tab.artifactId,
    active && !proto && !isSite && a.access !== 'view',
  )

  const projectAction = async (value: string) => {
    if (value === PROJECT.rename) return setRenaming(true)
    if (value === PROJECT.commands) return ask('commands')
    if (value === PROJECT.shortcuts) return ask('shortcuts')
    if (value === PROJECT.archive) return setArchiving(true)
    if (value === PROJECT.move) return setMoving(true)
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
          visibility={a.visibility}
          createdBy={a.createdBy}
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
          onEdit={(ops) => editArtifact(tab.artifactId, base, ops)}
          onBack={() => setProto(null)}
          onCanvasRules={(screen) => {
            setProto(null)
            setRequest((r) => ({ what: 'rules', screen, n: (r?.n ?? 0) + 1 }))
          }}
          onShare={() => setSharing(true)}
          screenThumbs={detail?.id === shown ? (detail.screenThumbs ?? []) : []}
          files={detail?.id === shown ? detail.files : null}
          readFile={(file) => readArtifactFile(tab.artifactId, file, shown ?? base)}
        />
        {shareDialog}
      </div>
    )

  return (
    <div className="art">
      <header className="art-bar">
        {!isSite && head && !rail.open ? (
          <Button
            size="small"
            variant="plain"
            className="art-bar__rail"
            aria-label={t('展开侧栏')}
            title={t('展开侧栏')}
            onClick={() => rail.setOpen(true)}
          >
            <Icon name="sidebar" size={15} />
          </Button>
        ) : null}
        <MenuButton
          className="ui-btn ui-btn--plain ui-btn--small art-bar__menu"
          aria-label={t('产物菜单')}
          items={[
            { label: t('重命名'), value: PROJECT.rename },
            { label: t('创建副本'), value: PROJECT.duplicate },
            ...(manager ? [{ label: t('移动到群…'), value: PROJECT.move }] : []),
            { label: t('下载 .zip'), value: PROJECT.download, disabled: !head },
            ...(!isSite
              ? [
                  { separator: true as const },
                  { label: t('命令菜单'), value: PROJECT.commands, shortcut: '⌘K', disabled: !head },
                  { label: t('快捷键'), value: PROJECT.shortcuts, shortcut: '?', disabled: !head },
                ]
              : []),
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
        {a.runner ? (
          <Runner status={a.runner.status} name={groupBots.find((b) => b.id === a.runner?.botId)?.name} />
        ) : null}
        <ActivityNote artifactId={a.id} />
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
        {isSite ? (
          <>
            <Button
              size="small"
              variant="plain"
              icon="external"
              aria-label={t('新窗口打开')}
              title={t('新窗口打开')}
              disabled={!preview}
              onClick={() => preview && window.open(preview.url, '_blank', 'noopener')}
            >
              {t('新窗口打开')}
            </Button>
            <Button
              size="small"
              variant="plain"
              icon="expand"
              aria-label={t('全屏')}
              title={t('全屏')}
              disabled={!preview}
              onClick={() => void siteFrame.current?.requestFullscreen?.()}
            >
              {t('全屏')}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="small"
              variant="plain"
              icon="play"
              aria-label={t('预览原型')}
              disabled={!preview || !shownManifest}
              onClick={present}
            >
              {t('预览')}
            </Button>
            <Button
              size="small"
              icon="download"
              className="art-bar__export"
              aria-label={t('导出')}
              disabled={!head}
              onClick={() => ask('export')}
            >
              <span className="art-bar__export-label">{t('导出')}</span>
            </Button>
          </>
        )}
        <Button size="small" variant="primary" icon="share" onClick={() => setSharing(true)}>
          {t('分享')}
        </Button>
      </header>
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
          <Button size="small" disabled={busy} onClick={() => void adopt()}>
            {t('设为当前版本')}
          </Button>
        </div>
      ) : null}
      {previewError ? (
        <EmptyState icon="grid" title={t('打不开产物预览')} description={previewError} />
      ) : isSite ? (
        !head ? (
          <Generating />
        ) : preview ? (
          <iframe
            ref={siteFrame}
            className="art-site__frame"
            title={a.title}
            src={preview.url}
            allowFullScreen
          />
        ) : (
          <div className="art-site__wait">
            <Spinner />
          </div>
        )
      ) : (
        <div className={`art-main${rail.narrow ? ' art-main--narrow' : ''}`} ref={rail.ref}>
          {rail.open && rail.narrow ? (
            <div
              className="art-rail__backdrop"
              data-testid="art-rail-backdrop"
              aria-hidden="true"
              onClick={() => rail.setOpen(false)}
            />
          ) : null}
          {rail.open ? (
            <PageRail
              artifactId={a.id}
              groupId={a.groupId}
              manifest={shownManifest ?? null}
              readOnly={readOnly || !head}
              canEdit={a.access !== 'view'}
              narrow={rail.narrow}
              refreshKey={`${head}|${a.running ? 1 : 0}`}
              onEdit={(ops) => editArtifact(tab.artifactId, base, ops)}
              onClose={() => rail.setOpen(false)}
              versionId={viewing}
              onPicked={() => rail.narrow && rail.setOpen(false)}
            />
          ) : null}
          <div className="art-stage">
            {!head && (a.running || a.queued) ? (
              <Generating />
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
                onEdit={(ops) => editArtifact(tab.artifactId, base, ops)}
                onFavourites={(ids) => void attempt(() => setFavorites(tab.artifactId, ids))}
                onPresent={present}
                readFile={(file) => readArtifactFile(tab.artifactId, file, shown ?? base)}
                fileUrl={(file) => artifactFileUrl(tab.artifactId, file, shown ?? base)}
                screenThumbs={detail?.id === shown ? (detail.screenThumbs ?? []) : []}
                changedScreens={detail?.id === shown ? (detail.changedScreens ?? []) : []}
                files={detail?.id === shown ? detail.files : null}
                dir={a.dir}
                designMd={design.md}
                designPanel={design.panel}
                guardDesign={design.guard}
                request={request}
                onRequestHandled={() => setRequest((r) => r && { ...r, handled: true })}
                versions={entry.versions}
                onViewVersion={(id) => setViewing(id === head ? null : id)}
                onPrototypeAsked={() => {
                  awaitProto.current = a.running ? 'running' : 'asked'
                }}
              />
            )}
            {chatRoot ? (
              <CanvasComposer
                groupId={a.groupId}
                chat={{ rootId: chatRoot, artifactId: a.id, botId: a.botId, designSystem: true }}
              />
            ) : null}
          </div>
        </div>
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
            onDone={leave}
            onClose={() => setArchiving(false)}
          />
        ) : null}
      </Presence>
      <Presence>
        {moving ? <MoveDialog artifact={a} tabKey={tabKey} onClose={() => setMoving(false)} /> : null}
      </Presence>
    </div>
  )
}

/** A bot's live run has the artifact: who and what, without locking anything (its version merges in). */
function Runner({ status, name }: { status: RunnerStatus; name: string | undefined }) {
  return (
    <span
      className="art-runner"
      role="status"
      data-status={status}
      title={t('你可以继续编辑，AI 交稿时自动合并；同一文件冲突时保留为候选版本')}
    >
      {status === 'running' ? <Spinner size={11} /> : <i className="art-runner__dot" aria-hidden="true" />}
      {runnerText(status, name)}
    </span>
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
    ...(a?.running ? { status: 'running' as const } : {}),
  }
}
