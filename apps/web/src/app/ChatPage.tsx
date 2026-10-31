import type { GroupDto, GroupPreviewsDto } from '@gonggong/protocol'
import { Suspense, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { useLinkedArtifact } from '../features/artifacts/link'
import type { BotTab } from '../features/bots/BotSettings'
import { BotDialog, BotPage, NewBotDialog } from '../features/bots/lazy'
import { confirmBot } from '../features/bots/model'
import { ChatView } from '../features/chat/ChatView'
import { BindMachineDialog, MachinePage } from '../features/machines/lazy'
import { openInWorkbench } from '../features/previews/store'
import { useGroupOutsideList } from '../features/teams/store'
import { loadTerminalSpaces, useTerminalSpaces } from '../features/terminal/spaces'
import { openTab } from '../features/workbench/open'
import { WorksPage } from '../features/works/WorksPage'
import { t } from '../i18n'
import { api } from '../lib/api'
import { named } from '../lib/lazy'
import { realtime } from '../lib/realtime'
import { Button, DeniedArt, EmptyState, FailedArt, Mascot, PickChatArt, Presence } from '../ui'
import { AppRail, isWorksPath } from './AppRail'
import { ShellBar } from './AppShell'
import { ChatLayout } from './ChatLayout'
import { useInspector } from './inspector'
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

/** Module-level so re-renders don't detach and re-attach the inspector host (a new ref callback is called twice). */
const setInspectorHost = (host: HTMLElement | null) => useInspector.setState({ host })

/** Loads my groups; reloads after a realtime reconnect to catch up. */
const loadSpaces = () =>
  loadTerminalSpaces().catch((e: Error) => console.warn('terminal spaces failed to load:', e))

function useChatData() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    loadGroups(setState)
    void loadSpaces()
    return realtime.onReconnect(() => {
      loadGroups(setState)
      void loadSpaces()
    })
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

export function ChatPage() {
  const { groupId, botId, machineId, spaceId } = useParams()
  const navigate = useNavigate()
  // 我的机器管理: its tree replaces the conversation list; /machines alone opens nothing yet.
  const { pathname } = useLocation()
  const managing = isMachinesPath(pathname)
  const works = isWorksPath(pathname)
  const mobile = useIsMobile()
  const me = useSession((s) => s.user)
  const { groups, bots, machines, workspaceLoaded } = useWorkspace(
    useShallow((s) => ({ groups: s.groups, bots: s.bots, machines: s.machines, workspaceLoaded: s.loaded })),
  )
  const [groupsState, retryGroups] = useChatData()
  const [creating, setCreating] = useState(false)
  const [fromFeishu, setFromFeishu] = useLinkedFeishuChat()
  const [binding, setBinding] = useState(false)
  const [newBot, setNewBot] = useState(false)
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
    if (groupId || spaceId || managing || works || mobile || groupsState !== 'ready' || !groups.length) return
    const target = groups.find((g) => g.id === lastGroup()) ?? groups[0]
    if (target) navigate(`/g/${target.id}`, { replace: true })
  }, [groupId, spaceId, managing, works, mobile, groupsState, groups, navigate])

  return (
    <>
      <ChatLayout
        mobileView={groupId || botId || machineId || spaceId || works ? 'chat' : 'list'}
        sidebarLabel={managing ? t('我的机器管理') : undefined}
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
        rail={inspector ? <div ref={setInspectorHost} className="chat__inspector" /> : undefined}
        railOpen={!!inspector}
        railKind={inspector === 'group-info' ? 'info' : 'run'}
        sidebar={
          managing ? (
            <MachineSidebar
              bots={myBots}
              sharedBots={sharedBots}
              machines={myMachines}
              loaded={workspaceLoaded}
              onBindMachine={() => setBinding(true)}
              onNewBot={() => setNewBot(true)}
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
              onNewBot={() => setNewBot(true)}
            />
          )
        }
      >
        {works ? (
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
          ) : (
            <div className="chat__placeholder">
              {workspaceLoaded ? (
                <EmptyState illustration={<DeniedArt />} title={t('机器不存在或已吊销')} />
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
                <EmptyState illustration={<DeniedArt />} title={t('Bot 不存在或已删除')} />
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
              <EmptyState illustration={<DeniedArt />} title={t('终端不存在或已删除')} />
            </div>
          )
        ) : managing ? (
          <div className="chat__placeholder">
            <EmptyState
              illustration={<PickChatArt />}
              title={t('选择一台机器或 Bot')}
              description={t('在左侧查看机器与其上的 Bot，管理配置、权限与共享。')}
            />
          </div>
        ) : group ? (
          <ChatView key={group.id} group={group} onBack={mobile ? () => navigate('/') : undefined} />
        ) : viewed ? (
          <ChatView
            key={`${viewed.id}:view`}
            group={viewed}
            readOnly
            onBack={mobile ? () => navigate('/') : undefined}
          />
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
              onNewBot={() => setNewBot(true)}
              onNewGroup={() => setCreating(true)}
            />
          </div>
        ) : (
          <div className="chat__placeholder">
            <EmptyState
              illustration={groupId ? <DeniedArt /> : <PickChatArt />}
              title={groupId ? t('群不存在或你已不在群内') : t('选择一个群或私聊开始')}
              description={t('在左侧选择会话；@ Bot 即可让团队成员机器上的 Claude Code / Codex 开始工作。')}
            />
          </div>
        )}
      </ChatLayout>
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
            <BindMachineDialog open onClose={() => setBinding(false)} />
          </Suspense>
        ) : null}
      </Presence>
      <Presence>
        {newBot && me ? (
          <Suspense fallback={null}>
            <NewBotDialog me={me} onClose={() => setNewBot(false)} />
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
