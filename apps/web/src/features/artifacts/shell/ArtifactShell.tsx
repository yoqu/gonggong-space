import type {
  ArtifactDto,
  ArtifactThreadDto,
  ArtifactThreadStatus,
  ArtifactVersionDto,
} from '@gonggong/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../../../app/session'
import { t } from '../../../i18n'
import { downloadUrl } from '../../../lib/download'
import { attempt } from '../../../lib/errors'
import { ago } from '../../../lib/time'
import {
  Button,
  ConfirmActionDialog,
  EmptyState,
  Icon,
  MenuButton,
  Presence,
  Spinner,
  toast,
} from '../../../ui'
import { ActivityNote } from '../ActivityLayer'
import { useGroupBots } from '../actions'
import { CanvasChat, CanvasComposer } from '../CanvasChat'
import { useFrontCanvasChat } from '../chatRoot'
import { exportZipUrl } from '../ExportPanel'
import { useLeaveArtifact } from '../host'
import { MoveDialog } from '../MoveDialog'
import { type RunnerStatus, runnerText } from '../runner'
import { Panel } from '../SidePanel'
import { ShareDialog, useArtifactManager } from '../share'
import {
  archiveArtifact,
  duplicateArtifact,
  openArtifact,
  renameArtifact,
  restoreVersion,
  useArtifactPreview,
} from '../store'
import { type ChromeReport, type ChromeSavedState, newExportRequestId } from './chrome'
import { EditorStage, type EditorStageHandle } from './EditorStage'
import { HistorySidebar } from './HistorySidebar'
import { SiteStage } from './SiteStage'
import { ThreadsSidebar } from './ThreadsSidebar'
import {
  createArtifactThread,
  deleteArtifactThread,
  replyArtifactThread,
  sendArtifactThreads,
  updateArtifactThread,
  useArtifactThreads,
} from './threadsApi'
import './shell.css'

type SidebarTab = 'threads' | 'chat' | 'history' | null

const SOURCE: Record<ArtifactVersionDto['source'], string> = {
  run: t('AI 生成'),
  edit: t('手动编辑'),
  local: t('本机改动'),
  host: t('托管上传'),
}

const SAVED_LABEL: Record<ChromeSavedState, string> = {
  saved: t('已保存'),
  saving: t('保存中…'),
  unsaved: t('未保存'),
  reconnecting: t('重连中…'),
  readonly: t('只读'),
}

const PROJECT = {
  rename: 'rename',
  duplicate: 'duplicate',
  move: 'move',
  download: 'download',
  archive: 'archive',
} as const

/**
 * Unified container Shell (docs/plan/产物容器-开发计划.md §4.2) for non-prototype artifacts
 * (`site`, `slides`, `whiteboard`, `motion`): top bar, stage (SiteStage or open-artifact EditorStage),
 * and collapsible right sidebar (comment threads, AI chat, version history).
 */
export function ArtifactShell({
  artifact: a,
  versions,
  tabKey,
  active,
}: {
  artifact: ArtifactDto
  versions: ArtifactVersionDto[]
  tabKey: string
  active: boolean
}) {
  const me = useSession((s) => s.user)
  const manager = useArtifactManager(a.groupId, a.botId, a.createdBy, a.canManage)
  const leave = useLeaveArtifact(tabKey)
  const groupBots = useGroupBots(a.groupId)
  const [viewing, setViewing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sidebar, setSidebar] = useState<SidebarTab>(null)
  const [annotating, setAnnotating] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [pickedBotId, setPickedBotId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [moving, setMoving] = useState(false)
  const [chrome, setChrome] = useState<ChromeReport | null>(null)

  const siteFrame = useRef<HTMLIFrameElement>(null)
  const editorRef = useRef<EditorStageHandle>(null)

  const head = a.headVersionId
  const shown = viewing ?? head
  const viewOnly = a.access === 'view'
  const readOnly = viewOnly || !!viewing || busy
  const isSite = a.kind === 'site'

  const { preview, error: previewError } = useArtifactPreview(a.id, viewing, !!head)
  const { threads, setThreads } = useArtifactThreads(a.id, !!head)

  const chatRoot = useFrontCanvasChat(a.groupId, a.id, active && !viewOnly && sidebar === 'chat')

  const bot = useMemo(
    () =>
      (pickedBotId ? groupBots.find((b) => b.id === pickedBotId) : null) ??
      (a.botId ? groupBots.find((b) => b.id === a.botId) : null) ??
      groupBots[0] ??
      null,
    [pickedBotId, groupBots, a.botId],
  )

  const current = versions.find((v) => v.id === shown)
  // Site pins are page coordinates of one version; editor anchors follow content, and every save is a new version.
  const threadVersion = isSite ? shown : null
  const shownThreads = useMemo(
    () => (threadVersion ? threads.filter((x) => x.versionId === threadVersion) : threads),
    [threads, threadVersion],
  )
  const openCount = shownThreads.filter((x) => x.status === 'open').length

  useEffect(() => {
    if (readOnly && annotating) setAnnotating(false)
  }, [readOnly, annotating])

  const toggleSidebar = (tab: Exclude<SidebarTab, null>) => setSidebar((cur) => (cur === tab ? null : tab))

  const projectAction = async (value: string) => {
    if (value === PROJECT.rename) return setRenaming(true)
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

  const finishRename = (next: string | null) => {
    setRenaming(false)
    if (next && next !== a.title) void attempt(() => renameArtifact(a.id, next))
  }

  // A past version is read-only: leaving the head before the editor saved would drop its last edits.
  const selectVersion = (id: string) => {
    if (id !== head && !viewing && chrome?.leaveLosesWork) {
      toast({ type: 'error', message: t('还有未保存的修改，保存后再查看历史版本') })
      return
    }
    setViewing(id === head ? null : id)
  }

  const doRestore = async (versionId: string) => {
    const target = versions.find((v) => v.id === versionId)
    setBusy(true)
    const ok = await attempt(async () => {
      await restoreVersion(a.id, versionId)
      setViewing(null)
    })
    setBusy(false)
    if (ok && target) toast({ type: 'success', message: t('已切换到 v{n}', { n: target.n }) })
  }

  const onCreatePin = async (point: { x: number; y: number }, text: string) => {
    if (!shown) return
    let created: ArtifactThreadDto | null = null
    const ok = await attempt(async () => {
      created = await createArtifactThread(a.id, {
        versionId: shown,
        anchor: { kind: 'site', path: '/', point },
        label: `/ (${point.x}, ${point.y})`,
        location: { path: '/', x: point.x, y: point.y },
        text,
      })
    })
    if (!ok || !created) return
    const nextThread = created as ArtifactThreadDto
    setThreads((prev) => (prev.some((x) => x.id === nextThread.id) ? prev : [...prev, nextThread]))
    setActiveThreadId(nextThread.id)
    setAnnotating(false)
    setSidebar('threads')
  }

  const onReply = async (threadId: string, text: string) => {
    let updated: ArtifactThreadDto | null = null
    if (
      await attempt(async () => {
        updated = await replyArtifactThread(threadId, { text, to: [] })
      })
    ) {
      const u = updated as ArtifactThreadDto | null
      if (u) setThreads((prev) => prev.map((x) => (x.id === u.id ? u : x)))
    }
  }

  const onStatus = async (threadId: string, status: ArtifactThreadStatus) => {
    let updated: ArtifactThreadDto | null = null
    if (
      await attempt(async () => {
        updated = await updateArtifactThread(threadId, { status })
      })
    ) {
      const u = updated as ArtifactThreadDto | null
      if (u) setThreads((prev) => prev.map((x) => (x.id === u.id ? u : x)))
    }
  }

  const onDeleteThread = async (threadId: string) => {
    if (await attempt(() => deleteArtifactThread(threadId)))
      setThreads((prev) => prev.filter((x) => x.id !== threadId))
  }

  const onSendThreads = async (ids: string[], extra: string) => {
    if (!bot || !ids.length) return false
    let sentId: string | null = null
    const ok = await attempt(async () => {
      const msg = await sendArtifactThreads(a.id, {
        threadIds: ids,
        botId: bot.id,
        ...(extra ? { extra } : {}),
      })
      sentId = msg.id
    })
    if (!ok) return false
    setThreads((prev) =>
      prev.map((x) => (ids.includes(x.id) ? { ...x, status: 'sent', sentMessageId: sentId } : x)),
    )
    setSidebar('chat')
    return true
  }

  const onSelectThread = (th: ArtifactThreadDto) => {
    setActiveThreadId(th.id)
    if (sidebar !== 'threads') setSidebar('threads')
  }

  const exportItems = useMemo(() => {
    const out: { label: string; value: string }[] = []
    for (const f of chrome?.formats ?? []) {
      if (f.variants?.length) {
        for (const v of f.variants) out.push({ label: `${f.label} · ${v.label}`, value: `${f.id}:${v.id}` })
      } else {
        out.push({ label: f.label, value: f.id })
      }
    }
    return out
  }, [chrome?.formats])

  const triggerExport = (value: string) => {
    const [format, variant] = value.split(':')
    if (!format) return
    editorRef.current?.sendCommand({
      cmd: 'export_format',
      request: newExportRequestId(),
      format,
      ...(variant ? { variant } : {}),
    })
  }

  const orderedVersions = [...versions].sort((x, y) => y.n - x.n)

  return (
    <div className="art art-shell" data-testid="artifact-shell" data-kind={a.kind}>
      <header className="art-bar art-shell__bar">
        {!viewOnly ? (
          <MenuButton
            className="ui-btn ui-btn--plain ui-btn--small art-bar__menu"
            aria-label={t('产物菜单')}
            items={[
              { label: t('重命名'), value: PROJECT.rename },
              { label: t('创建副本'), value: PROJECT.duplicate },
              ...(manager ? [{ label: t('移动到群…'), value: PROJECT.move }] : []),
              { label: t('下载 .zip'), value: PROJECT.download, disabled: !head },
              { separator: true },
              { label: t('删除产物'), value: PROJECT.archive, destructive: true },
            ]}
            onSelect={(v) => void projectAction(v)}
          >
            <Icon name={isSite ? 'globe' : 'slides'} size={15} className="art-bar__icon" />
            <Icon name="chevron-down" size={10} weight={2} />
          </MenuButton>
        ) : (
          <Icon name={isSite ? 'globe' : 'slides'} size={15} className="art-bar__icon" />
        )}
        {renaming ? (
          <ShellTitleField title={a.title} onDone={finishRename} />
        ) : (
          <h2 className="art-bar__title" title={a.title} onDoubleClick={() => !viewOnly && setRenaming(true)}>
            {a.title}
          </h2>
        )}
        {orderedVersions.length ? (
          <MenuButton
            className="ui-btn ui-btn--plain ui-btn--small art-bar__version"
            aria-label={t('版本')}
            items={orderedVersions.map((v) => ({
              label: v.id === head ? t('v{n}（当前）', { n: v.n }) : `v${v.n}`,
              value: v.id,
              shortcut: [SOURCE[v.source], v.authorName, ago(v.createdAt)].filter(Boolean).join(' · '),
              checked: v.id === shown,
            }))}
            onSelect={selectVersion}
          >
            {current ? `v${current.n}` : t('版本')}
            <Icon name="chevron-down" size={10} weight={2} />
          </MenuButton>
        ) : null}
        {a.runner ? (
          <ShellRunner
            status={a.runner.status}
            name={groupBots.find((b) => b.id === a.runner?.botId)?.name}
          />
        ) : null}
        <ActivityNote artifactId={a.id} />
        {chrome?.saved ? (
          <span className="art-shell__saved" data-testid="shell-saved">
            {SAVED_LABEL[chrome.saved]}
          </span>
        ) : null}
        <span className="art-bar__fill" />
        {isSite && !readOnly ? (
          <Button
            size="small"
            variant={annotating ? 'primary' : 'plain'}
            icon="mappin"
            data-testid="shell-annotate-btn"
            aria-pressed={annotating}
            onClick={() => setAnnotating((on) => !on)}
          >
            {annotating ? t('退出批注模式') : t('添加批注')}
          </Button>
        ) : null}
        <Button
          size="small"
          variant={sidebar === 'threads' ? 'default' : 'plain'}
          icon="thread"
          data-testid="shell-threads-btn"
          aria-pressed={sidebar === 'threads'}
          onClick={() => toggleSidebar('threads')}
        >
          {openCount > 0 ? `${t('批注')} ${openCount}` : t('批注')}
        </Button>
        {!viewOnly ? (
          <Button
            size="small"
            variant={sidebar === 'chat' ? 'default' : 'plain'}
            icon="sparkle"
            data-testid="shell-chat-btn"
            aria-pressed={sidebar === 'chat'}
            onClick={() => toggleSidebar('chat')}
          >
            {t('AI 对话')}
          </Button>
        ) : null}
        <Button
          size="small"
          variant={sidebar === 'history' ? 'default' : 'plain'}
          icon="clock"
          data-testid="shell-history-btn"
          aria-pressed={sidebar === 'history'}
          onClick={() => toggleSidebar('history')}
        >
          {t('版本历史')}
        </Button>
        {exportItems.length ? (
          <MenuButton
            className="ui-btn ui-btn--plain ui-btn--small"
            aria-label={t('导出文件')}
            items={exportItems}
            onSelect={triggerExport}
          >
            <Icon name="download" size={14} />
            {t('导出')}
          </MenuButton>
        ) : null}
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
          onClick={() =>
            isSite ? void siteFrame.current?.requestFullscreen?.() : editorRef.current?.requestFullscreen()
          }
        >
          {t('全屏')}
        </Button>
        {!viewOnly ? (
          <Button size="small" variant="primary" icon="share" onClick={() => setSharing(true)}>
            {t('分享')}
          </Button>
        ) : null}
      </header>

      {viewing && current ? (
        <div className="art-past" role="status" data-testid="shell-past-banner">
          <Icon name="clock" size={14} />
          <span>{t('正在查看 v{n}（只读）', { n: current.n })}</span>
          <Button size="small" variant="plain" onClick={() => setViewing(null)}>
            {t('回到当前版本')}
          </Button>
          {!viewOnly ? (
            <Button size="small" disabled={busy} onClick={() => void doRestore(viewing)}>
              {t('设为当前版本')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="art-shell__body">
        <div className="art-shell__stage">
          {!head ? (
            <div className="art-site__wait">
              <Spinner />
            </div>
          ) : previewError ? (
            <EmptyState icon="grid" title={t('打不开产物预览')} description={previewError} />
          ) : isSite ? (
            <SiteStage
              title={a.title}
              src={preview?.url ?? null}
              versionKey={shown ?? ''}
              frameRef={siteFrame}
              threads={shownThreads}
              annotating={annotating}
              readOnly={readOnly}
              activeThreadId={activeThreadId}
              onCreatePin={onCreatePin}
              onSelectThread={onSelectThread}
            />
          ) : (
            <EditorStage
              artifact={a}
              versionId={shown}
              preview={preview}
              readOnly={readOnly}
              botId={bot?.id ?? null}
              agentStatus={{
                available: !!bot,
                busy: a.running,
                name: bot?.name ?? 'AI',
                waitingForPerson:
                  a.runner?.status === 'awaiting_answer' || a.runner?.status === 'awaiting_approval',
              }}
              chromeHandlers={{
                onReport: setChrome,
                onExportState: (ev) => {
                  if (ev.state === 'failed')
                    toast({ type: 'error', message: t('导出失败：{reason}', { reason: ev.reason ?? '' }) })
                },
              }}
              onStageAgent={() => setSidebar('chat')}
              handleRef={editorRef}
            />
          )}
        </div>

        {sidebar === 'threads' ? (
          <ThreadsSidebar
            threads={threads}
            versionId={threadVersion}
            meId={me?.id ?? null}
            readOnly={readOnly}
            activeId={activeThreadId}
            bots={groupBots}
            bot={bot}
            onPickBot={setPickedBotId}
            onSelect={onSelectThread}
            onReply={onReply}
            onStatus={onStatus}
            onDelete={onDeleteThread}
            onSend={onSendThreads}
            onClose={() => setSidebar(null)}
          />
        ) : null}

        {sidebar === 'chat' && !viewOnly ? (
          <Panel title={t('AI 对话')} onClose={() => setSidebar(null)}>
            <div className="art-shell__chat">
              <CanvasChat artifactId={a.id} groupId={a.groupId} />
              {chatRoot ? (
                <CanvasComposer
                  groupId={a.groupId}
                  chat={{ rootId: chatRoot, artifactId: a.id, botId: a.botId }}
                />
              ) : null}
            </div>
          </Panel>
        ) : null}

        {sidebar === 'history' ? (
          <HistorySidebar
            versions={versions}
            headId={head}
            shownId={shown}
            readOnly={viewOnly}
            busy={busy}
            onSelect={selectVersion}
            onRestore={doRestore}
            onClose={() => setSidebar(null)}
          />
        ) : null}
      </div>

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

function ShellRunner({ status, name }: { status: RunnerStatus; name: string | undefined }) {
  return (
    <span className="art-runner" role="status" data-status={status}>
      {status === 'running' ? <Spinner size={11} /> : <i className="art-runner__dot" aria-hidden="true" />}
      {runnerText(status, name)}
    </span>
  )
}

function ShellTitleField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
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
