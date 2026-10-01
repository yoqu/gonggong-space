import type { GroupDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { BotDialog } from '../features/bots/BotDialog'
import { BotPage } from '../features/bots/BotPage'
import { confirmBot } from '../features/bots/model'
import { NewBotDialog } from '../features/bots/NewBotDialog'
import { ChatView } from '../features/chat/ChatView'
import { type GroupKind, NewGroupDialog } from '../features/chat/NewGroupDialog'
import { BindMachineDialog } from '../features/machines/BindMachineDialog'
import { MachineDialog } from '../features/machines/MachineDialog'
import { useGroupOutsideList } from '../features/teams/store'
import { openTab } from '../features/workbench/open'
import { Workbench } from '../features/workbench/Workbench'
import { t } from '../i18n'
import { api } from '../lib/api'
import { realtime } from '../lib/realtime'
import { Button, DeniedArt, EmptyState, FailedArt, Mascot, PickChatArt, Presence } from '../ui'
import { AppRail } from './AppRail'
import { ShellBar } from './AppShell'
import { ChatLayout } from './ChatLayout'
import { useInspector } from './inspector'
import { ChatStrip, ConversationStrip, Sidebar } from './Sidebar'
import { useSession } from './session'
import { useIsMobile } from './viewport'
import { Welcome } from './Welcome'
import { useWorkbench } from './workbench'
import { useWorkspace } from './workspace'

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
function useChatData() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    loadGroups(setState)
    let wasOpen = realtime.getStatus() === 'open'
    return realtime.onStatus((st) => {
      if (st === 'open' && wasOpen) loadGroups(setState)
      if (st === 'open') wasOpen = true
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
  const { groupId, botId } = useParams()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const me = useSession((s) => s.user)
  const { groups, bots, machines, loaded: workspaceLoaded } = useWorkspace()
  const [groupsState, retryGroups] = useChatData()
  const [creating, setCreating] = useState<GroupKind | null>(null)
  const [binding, setBinding] = useState(false)
  const [newBot, setNewBot] = useState(false)
  const [settingBotId, setSettingBotId] = useState<string | null>(null)
  const [machineId, setMachineId] = useState<string | null>(null)
  const myBots = bots.filter((b) => b.ownerId === me?.id)
  const myMachines = machines.filter((m) => m.ownerId === me?.id)
  const firstRun = !groupId && !botId && groupsState === 'ready' && !groups.length
  const openBot = bots.find((b) => b.id === botId)
  const openMachine = machines.find((m) => m.id === machineId)
  const group = groups.find((g) => g.id === groupId)
  const inspector = useInspector((s) => s.view)
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching groups closes the rail
  useEffect(() => () => useInspector.getState().close(), [groupId])
  // The group must be loaded, so the workbench has switched to it for good.
  useLinkedRun(group?.id)
  useLinkedBot()
  const viewed = useGroupOutsideList(groupId, groupsState === 'ready' && !group)
  const benchGroup = botId ? null : (group?.id ?? null)
  useEffect(() => useWorkbench.getState().setGroup(benchGroup), [benchGroup])
  const benchShown = useWorkbench(
    (s) => !!benchGroup && s.groupId === benchGroup && s.open && !!s.benches[benchGroup]?.tabs.length,
  )
  useEffect(() => {
    if (group) rememberGroup(group.id)
  }, [group])
  // Desktop home resumes the last opened group; mobile home is the conversation list itself.
  useEffect(() => {
    if (groupId || botId || mobile || groupsState !== 'ready' || !groups.length) return
    const target = groups.find((g) => g.id === lastGroup()) ?? groups[0]
    if (target) navigate(`/g/${target.id}`, { replace: true })
  }, [groupId, botId, mobile, groupsState, groups, navigate])

  return (
    <>
      <ChatLayout
        mobileView={groupId || botId ? 'chat' : 'list'}
        nav={(orientation) => <AppRail orientation={orientation} />}
        workbench={benchShown ? <Workbench /> : undefined}
        strip={<ConversationStrip groups={groups} />}
        chatStrip={group ? <ChatStrip key={group.id} group={group} /> : null}
        rail={
          inspector ? (
            <div ref={(host) => useInspector.setState({ host })} className="chat__inspector" />
          ) : undefined
        }
        railOpen={!!inspector}
        railKind={inspector === 'group-info' ? 'info' : 'run'}
        sidebar={
          <Sidebar
            groups={groups}
            bots={myBots}
            machines={myMachines}
            guide={!firstRun || mobile}
            header={<ShellBar onNewGroup={() => setCreating('group')} />}
            onNewGroup={() => setCreating('group')}
            onNewDm={() => setCreating('dm')}
            loaded={workspaceLoaded && groupsState === 'ready'}
            onBindMachine={() => setBinding(true)}
            onNewBot={() => setNewBot(true)}
            onOpenMachine={setMachineId}
            onConfirmBot={(id) => void confirmBot(id)}
          />
        }
      >
        {botId ? (
          openBot && me ? (
            <BotPage
              key={openBot.id}
              bot={openBot}
              me={me}
              onSettings={() => setSettingBotId(openBot.id)}
              onBack={mobile ? () => navigate('/') : undefined}
            />
          ) : (
            <div className="chat__placeholder">
              {workspaceLoaded ? (
                <EmptyState illustration={<DeniedArt />} title={t('Bot 不存在或已删除')} />
              ) : (
                <Mascot action="wait" size={72} label={t('加载中')} />
              )}
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
              onNewGroup={() => setCreating('group')}
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
        {creating && me ? <NewGroupDialog me={me} kind={creating} onClose={() => setCreating(null)} /> : null}
      </Presence>
      <BindMachineDialog open={binding} onClose={() => setBinding(false)} />
      <Presence>{newBot && me ? <NewBotDialog me={me} onClose={() => setNewBot(false)} /> : null}</Presence>
      <Presence>
        {openBot && openBot.id === settingBotId && me ? (
          <BotDialog bot={openBot} me={me} onClose={() => setSettingBotId(null)} />
        ) : null}
      </Presence>
      <Presence>
        {openMachine ? (
          <MachineDialog
            machine={openMachine}
            bots={myBots.filter((b) => b.machineId === openMachine.id)}
            onClose={() => setMachineId(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}
