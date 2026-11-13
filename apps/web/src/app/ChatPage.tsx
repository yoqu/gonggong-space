import type { GroupDto, GroupPreviewsDto } from '@gonggong/protocol'
import { Suspense, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { useLinkedArtifact } from '../features/artifacts/link'
import type { BotTab } from '../features/bots/BotSettings'
import { BotDialog, BotPage, NewBotDialog } from '../features/bots/lazy'
import { confirmBot } from '../features/bots/model'
import { ChatView } from '../features/chat/ChatView'
import { ThreadInbox } from '../features/chat/ThreadInbox'
import { UnreadInbox } from '../features/chat/UnreadInbox'
import { JoinPreview } from '../features/groups/JoinPreview'
import { loadSections, loadTeamSections, useTeamSections } from '../features/groups/sections'
import { AdminMachinePage, BindMachineDialog, MachinePage, MachinesOverview } from '../features/machines/lazy'
import { MarketPage } from '../features/market/MarketPage'
import { UserGuide } from '../features/onboarding/UserGuide'
import { openInWorkbench } from '../features/previews/store'
import { LaterPage } from '../features/saved/LaterPage'
import { useGroupOutsideList } from '../features/teams/store'
import { loadTerminalSpaces, useTerminalSpaces } from '../features/terminal/spaces'
import { openTab } from '../features/workbench/open'
import { WorksPage } from '../features/works/WorksPage'
import { t } from '../i18n'
import { api } from '../lib/api'
import { named } from '../lib/lazy'
import { realtime } from '../lib/realtime'
import { Button, DeniedArt, EmptyState, FailedArt, Mascot, PickChatArt, Presence } from '../ui'
import { AppRail, isMarketPath, isWorksPath } from './AppRail'
import { ShellBar } from './AppShell'
import { ChatLayout } from './ChatLayout'
import { InspectorSlot, useInspector } from './inspector'
import { isMachinesPath, MachineSidebar } from './MachineSidebar'
import { ChatStrip, ConversationStrip, Sidebar } from './Sidebar'
import { useSession } from './session'
import { useIsMobile } from './viewport'
import { Welcome } from './Welcome'
import { useWorkbench } from './workbench'
import { useWorkspace } from './workspace'

const NewGroupDialog = named(() => import('../features/chat/NewGroupDialog'), 'NewGroupDialog')
const FeishuGroupDialog = named(() => import('../features/feishu/FeishuGroupDialog'), 'FeishuGroupDialog')
const Workbench = named(() => import('../features/workbench/Workbench'), 'Workbench')
const TerminalSpacePage = named(() => import('../features/terminal/TerminalSpacePage'), 'TerminalSpacePage')

const LAST_GROUP_KEY = 'gonggong.lastGroup'

const lastGroup = () => {
  try {
    return localStorage.getItem(LAST_GROUP_KEY)
  } catch {
    return null
  }
}

const rememberGroup = (id: string) => {
  try {
    localStorage.setItem(LAST_GROUP_KEY, id)
  } catch {
    // storage unavailable (private mode): home just falls back to the first group
  }
}

function loadGroups(setState: (s: 'ready' | 'error') => void) {
  api.get<GroupDto[]>('/groups').then(
    (groups) => {
      useWorkspace.setState({ groups })
      setState('ready')
    },
    () => setState('error'),
  )
}

/** Loads my groups; reloads after a realtime reconnect to catch up. */
const loadTeam = () =>
  loadTeamSections().catch((e: Error) => console.warn('team sections failed to load:', e))
const loadSpaces = () => {
  loadTerminalSpaces().catch((e: Error) => console.warn('terminal spaces failed to load:', e))
  loadSections().catch((e: Error) => console.warn('sidebar sections failed to load:', e))
  void loadTeam()
}

function useChatData() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    loadGroups(setState)
    loadSpaces()
    // Leaving a group puts it back in the directory if it is filed under a 团队分区.
    const off = realtime.subscribe((e) => {
      if (e.t === 'directory.changed' || e.t === 'group.removed') void loadTeam()
    })
    const offReconnect = realtime.onReconnect(() => {
      loadGroups(setState)
      loadSpaces()
    })
    return () => {
      off()
      offReconnect()
    }
  }, [])
  const retry = () => {
    setState('loading')
    loadGroups(setState)
  }
  return [state, retry] as const
}

/** `?run=<id>[&file=<path>]` from a notification or search hit opens that run's tab, then leaves the URL. */
function useLinkedRun(groupId: string | undefined) {
  const [params, setParams] = useSearchParams()
  const run = params.get('run')
  const file = params.get('file')
  // Tabs belong to the workbench's group: wait until it has switched to the linked one.
  const bench = useWorkbench((s) => s.groupId)
  useEffect(() => {
    if (!run || !groupId || bench !== groupId) return
    openTab({ kind: 'run', runId: run, view: file ? 'diff' : 'process', file })
    setParams({}, { replace: true })
  }, [run, file, groupId, bench, setParams])
}

/** `?preview=<id>` from a Feishu preview card opens that preview's tab (a closed one just lands in the group). */
function useLinkedPreview(groupId: string | undefined) {
  const [params, setParams] = useSearchParams()
  const id = params.get('preview')
  const bench = useWorkbench((s) => s.groupId)
  useEffect(() => {
    if (!id || !groupId || bench !== groupId) return
    api
      .get<GroupPreviewsDto>(`/groups/${groupId}/previews`)
      .then((list) => {
        const p = list.previews.find((x) => x.id === id)
        if (p) openInWorkbench(p)
      })
      .catch(() => {})
      .finally(() => setParams({}, { replace: true }))
  }, [id, groupId, bench, setParams])
}

/** `?feishuChat=<chat id>` (the main app's card in a new Feishu chat) opens 从飞书群创建 with that chat. */
function useLinkedFeishuChat() {
  const [params, setParams] = useSearchParams()
  const linked = params.get('feishuChat')
  const [open, setOpen] = useState<{ chatId?: string } | null>(null)
  useEffect(() => {
    if (!linked) return
    setOpen({ chatId: linked })
    setParams({}, { replace: true })
  }, [linked, setParams])
  return [open, setOpen] as const
}

/** `?bot=<id>` (the desktop app's 在 Web 中管理) opens that bot's page. */
function useLinkedBot() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const bot = params.get('bot')
  useEffect(() => {
    if (bot) navigate(`/bot/${bot}`, { replace: true })
  }, [bot, navigate])
}

export function ChatPage({ notFound = false }: { notFound?: boolean }) {
  const { groupId, botId, machineId, spaceId } = useParams()
  const navigate = useNavigate()
  // 机器与 Bot: its tree replaces the conversation list; /machines alone opens nothing yet.
  const { pathname } = useLocation()
  const managing = isMachinesPath(pathname)
  const works = isWorksPath(pathname)
  const threads = pathname === '/threads'
  const unreads = pathname === '/unreads'
  const later = pathname === '/later'
  const market = isMarketPath(pathname)
  const mobile = useIsMobile()
  const me = useSession((s) => s.user)
  const { groups, bots, machines, workspaceLoaded } = useWorkspace(
    useShallow((s) => ({ groups: s.groups, bots: s.bots, machines: s.machines, workspaceLoaded: s.loaded })),
  )
  const [groupsState, retryGroups] = useChatData()
  const [creating, setCreating] = useState(false)
  const [fromFeishu, setFromFeishu] = useLinkedFeishuChat()
  const [binding, setBinding] = useState(false)
  /** The new bot dialog, on `machineId` when opened right after binding it. */
  const [newBot, setNewBot] = useState<{ machineId?: string } | null>(null)
  const [setting, setSetting] = useState<{ botId: string; tab?: BotTab } | null>(null)
  const myBots = bots.filter((b) => b.ownerId === me?.id)
  const sharedBots = bots.filter((b) => !!me && b.sharedWith.includes(me.id))
  const myMachines = machines.filter((m) => m.ownerId === me?.id)
  const spaces = useTerminalSpaces((s) => s.spaces)
  const space = spaces.find((s) => s.id === spaceId)
  const firstRun = !managing && !groupId && !spaceId && groupsState === 'ready' && !groups.length
  const openBot = bots.find((b) => b.id === botId)
  const openMachine = machines.find((m) => m.id === machineId)
  const group = groups.find((g) => g.id === groupId)
  const preview = useTeamSections((s) => s.directory.find((g) => g.id === groupId))
  const joinable = useTeamSections((s) => s.directory[0]?.id)
  const inspector = useInspector((s) => s.view)
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching groups closes the rail
  useEffect(() => () => useInspector.getState().close(), [groupId])
  // The group must be loaded, so the workbench has switched to it for good.
  useLinkedRun(group?.id)
  useLinkedPreview(group?.id)
  useLinkedArtifact(group?.id)
  useLinkedBot()
  const viewed = useGroupOutsideList(groupId, groupsState === 'ready' && !group)
  const benchGroup = botId || machineId || spaceId ? null : (group?.id ?? null)
  useEffect(() => useWorkbench.getState().setGroup(benchGroup), [benchGroup])
  const benchShown = useWorkbench((s) => !!benchGroup && s.groupId === benchGroup && s.open)
  useEffect(() => {
    if (group) rememberGroup(group.id)
  }, [group])
  // Desktop home resumes the last opened group; mobile home is the conversation list itself.
  useEffect(() => {
    if (
      notFound ||
      groupId ||
      spaceId ||
      managing ||
      works ||
      threads ||
      unreads ||
      later ||
      market ||
      mobile ||
      groupsState !== 'ready' ||
      !groups.length
    )
      return
    const target = groups.find((g) => g.id === lastGroup()) ?? groups[0]
    if (target) navigate(`/g/${target.id}`, { replace: true })
  }, [
    notFound,
    groupId,
    spaceId,
    managing,
    works,
    threads,
    unreads,
    later,
    market,
    mobile,
    groupsState,
    groups,
    navigate,
  ])

  return (
    <>
      <ChatLayout
        mobileView={
          notFound ||
          groupId ||
          botId ||
          machineId ||
          spaceId ||
          works ||
          market ||
          threads ||
          unreads ||
          later
            ? 'chat'
            : 'list'
        }
        sidebarLabel={managing ? t('机器与 Bot') : undefined}
        nav={(orientation) => <AppRail orientation={orientation} />}
        workbench={
          benchShown ? (
            <Suspense fallback={null}>
              <Workbench />
            </Suspense>
          ) : undefined
        }
        strip={<ConversationStrip groups={groups} />}
        chatStrip={group ? <ChatStrip key={group.id} group={group} /> : null}
        rail={inspector ? <InspectorSlot /> : undefined}
        railOpen={!!inspector}
        railKind={
          inspector === 'group-info'
            ? 'info'
            : inspector === 'thread' || inspector === 'threads'
              ? 'thread'
              : 'run'
        }
        sidebar={
          // 市场 and 作品 are pages of their own: the conversation list beside them is noise, so they take the full width.
          market || works ? null : managing ? (
            <MachineSidebar
              bots={myBots}
              sharedBots={sharedBots}
              machines={myMachines}
              loaded={workspaceLoaded}
              onBindMachine={() => setBinding(true)}
              onNewBot={(machineId) => setNewBot({ machineId })}
              onConfirmBot={(id) => void confirmBot(id)}
            />
          ) : (
            <Sidebar
              groups={groups}
              bots={myBots}
              machines={myMachines}
              spaces={spaces}
              guide={!firstRun || mobile}
              header={<ShellBar onNewGroup={() => setCreating(true)} />}
              onNewGroup={() => setCreating(true)}
              loaded={workspaceLoaded && groupsState === 'ready'}
              onBindMachine={() => setBinding(true)}
              onNewBot={() => setNewBot({})}
            />
          )
        }
      >
        {notFound ? (
          <div className="chat__placeholder">
            <EmptyState
              illustration={<DeniedArt />}
              title={t('页面不存在')}
              description={t('链接可能已失效，或你没有访问权限。')}
              action={<Button onClick={() => navigate('/')}>{t('返回消息')}</Button>}
            />
          </div>
        ) : market ? (
          <MarketPage />
        ) : threads ? (
          <ThreadInbox onBack={mobile ? () => navigate('/') : undefined} />
        ) : unreads ? (
          <UnreadInbox onBack={mobile ? () => navigate('/') : undefined} />
        ) : later ? (
          <LaterPage onBack={mobile ? () => navigate('/') : undefined} />
        ) : works ? (
          <WorksPage />
        ) : machineId ? (
          openMachine ? (
            <Suspense fallback={null}>
              <MachinePage
                key={openMachine.id}
                machine={openMachine}
                bots={myBots.filter((b) => b.machineId === openMachine.id)}
                onBack={mobile ? () => navigate('/') : undefined}
              />
            </Suspense>
          ) : me?.role === 'sysadmin' ? (
            // Not one of mine: a sysadmin reads it from the admin list (opened from 机器与网络).
            <Suspense fallback={null}>
              <AdminMachinePage id={machineId} onBack={mobile ? () => navigate('/') : undefined} />
            </Suspense>
          ) : (
            <div className="chat__placeholder">
              {workspaceLoaded ? (
                <EmptyState
                  illustration={<DeniedArt />}
                  title={t('机器不存在或已吊销')}
                  description={t('可能已被删除，或你没有访问权限。')}
                  action={<Button onClick={() => navigate('/machines')}>{t('返回机器与 Bot')}</Button>}
                />
              ) : (
                <Mascot action="wait" size={72} label={t('加载中')} />
              )}
            </div>
          )
        ) : botId ? (
          openBot && me ? (
            <Suspense fallback={null}>
              <BotPage
                key={openBot.id}
                bot={openBot}
                me={me}
                onSettings={(tab) => setSetting({ botId: openBot.id, tab })}
                onBack={mobile ? () => navigate('/') : undefined}
              />
            </Suspense>
          ) : (
            <div className="chat__placeholder">
              {workspaceLoaded ? (
                <EmptyState
                  illustration={<DeniedArt />}
                  title={t('Bot 不存在或已删除')}
                  description={t('可能已被删除，或你没有访问权限。')}
                  action={<Button onClick={() => navigate('/machines')}>{t('返回机器与 Bot')}</Button>}
                />
              ) : (
                <Mascot action="wait" size={72} label={t('加载中')} />
              )}
            </div>
          )
        ) : spaceId ? (
          space ? (
            <Suspense fallback={null}>
              <TerminalSpacePage
                key={space.id}
                space={space}
                onBack={mobile ? () => navigate('/') : undefined}
              />
            </Suspense>
          ) : (
            <div className="chat__placeholder">
              <EmptyState
                illustration={<DeniedArt />}
                title={t('终端不存在或已删除')}
                action={<Button onClick={() => navigate('/')}>{t('返回消息')}</Button>}
              />
            </div>
          )
        ) : managing ? (
          workspaceLoaded ? (
            <Suspense fallback={null}>
              <MachinesOverview
                machines={myMachines}
                bots={myBots}
                onBindMachine={() => setBinding(true)}
                onNewBot={(machineId) => setNewBot({ machineId })}
              />
            </Suspense>
          ) : (
            <div className="chat__placeholder">
              <Mascot action="wait" size={72} label={t('加载中')} />
            </div>
          )
        ) : group ? (
          <ChatView key={group.id} group={group} onBack={mobile ? () => navigate('/') : undefined} />
        ) : viewed ? (
          <ChatView
            key={`${viewed.id}:view`}
            group={viewed}
            readOnly
            onBack={mobile ? () => navigate('/') : undefined}
          />
        ) : preview ? (
          <JoinPreview key={preview.id} group={preview} />
        ) : groupsState === 'loading' && (groupId || groups.length) ? (
          <div className="chat__placeholder">
            <Mascot action="wait" size={72} label={t('加载中')} />
          </div>
        ) : groupsState === 'error' ? (
          <div className="chat__placeholder">
            <EmptyState
              illustration={<FailedArt />}
              title={t('加载失败')}
              description={t('无法获取群列表，请检查网络后重试。')}
              action={<Button onClick={retryGroups}>{t('重试')}</Button>}
            />
          </div>
        ) : firstRun && me ? (
          <div className="chat__placeholder">
            <Welcome
              name={me.name}
              bound={myMachines.length > 0}
              hasBot={myBots.length > 0}
              onBindMachine={() => setBinding(true)}
              onNewBot={() => setNewBot({})}
              onNewGroup={() => setCreating(true)}
              onBrowse={joinable ? () => navigate(`/g/${joinable}`) : undefined}
            />
          </div>
        ) : (
          <div className="chat__placeholder">
            <EmptyState
              illustration={groupId ? <DeniedArt /> : <PickChatArt />}
              title={groupId ? t('群不存在或你已不在群内') : t('选择一个群或私聊开始')}
              description={
                groupId
                  ? t('它可能已解散，或你已被移出。')
                  : t(
                      '在左侧选择会话；@ Bot 即可让团队成员机器上的 Claude Code / Codex / Gemini CLI 开始工作。',
                    )
              }
              action={groupId ? <Button onClick={() => navigate('/')}>{t('返回消息')}</Button> : undefined}
            />
          </div>
        )}
      </ChatLayout>
      <UserGuide ready={workspaceLoaded && groupsState === 'ready'} />
      <Presence>
        {creating && me ? (
          <Suspense fallback={null}>
            <NewGroupDialog
              me={me}
              onClose={() => setCreating(false)}
              onFromFeishu={() => {
                setCreating(false)
                setFromFeishu({})
              }}
            />
          </Suspense>
        ) : null}
        {fromFeishu ? (
          <Suspense fallback={null}>
            <FeishuGroupDialog chatId={fromFeishu.chatId} onClose={() => setFromFeishu(null)} />
          </Suspense>
        ) : null}
      </Presence>
      <Presence>
        {binding ? (
          <Suspense fallback={null}>
            <BindMachineDialog
              open
              onClose={() => setBinding(false)}
              onNewBot={(machineId) => {
                setBinding(false)
                setNewBot({ machineId })
              }}
            />
          </Suspense>
        ) : null}
      </Presence>
      <Presence>
        {newBot && me ? (
          <Suspense fallback={null}>
            <NewBotDialog me={me} machineId={newBot.machineId} onClose={() => setNewBot(null)} />
          </Suspense>
        ) : null}
      </Presence>
      <Presence>
        {openBot && openBot.id === setting?.botId && me ? (
          <Suspense fallback={null}>
            <BotDialog bot={openBot} me={me} tab={setting.tab} onClose={() => setSetting(null)} />
          </Suspense>
        ) : null}
      </Presence>
    </>
  )
}
