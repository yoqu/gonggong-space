import type { GroupDto } from '@aiws/protocol'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import deniedArt from '../assets/illustrations/denied.png'
import failedArt from '../assets/illustrations/failed.png'
import pickChatArt from '../assets/illustrations/pick-chat.png'
import { PreviewPanel } from '../features/attachments/PreviewPanel'
import { usePreview } from '../features/attachments/preview'
import { BotDialog } from '../features/bots/BotDialog'
import { botsApi } from '../features/bots/model'
import { NewBotDialog } from '../features/bots/NewBotDialog'
import { ChatView } from '../features/chat/ChatView'
import { type GroupKind, NewGroupDialog } from '../features/chat/NewGroupDialog'
import { BindMachineDialog } from '../features/machines/BindMachineDialog'
import { MachineDialog } from '../features/machines/MachineDialog'
import { RunRail } from '../features/runs/RunRail'
import { useRunRail } from '../features/runs/rail'
import { api } from '../lib/api'
import { realtime } from '../lib/realtime'
import { Button, EmptyState, Spinner, toast } from '../ui'
import { ChatLayout } from './ChatLayout'
import { Sidebar } from './Sidebar'
import { useSession } from './session'
import { useIsMobile } from './viewport'
import { useWorkspace } from './workspace'

const LAST_GROUP_KEY = 'aiws.lastGroup'

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

/** `?run=<id>[&file=<path>]` from a notification or search hit opens that run in the rail, then leaves the URL. */
function useLinkedRun() {
  const [params, setParams] = useSearchParams()
  const run = params.get('run')
  const file = params.get('file')
  useEffect(() => {
    if (!run) return
    useRunRail.getState().open(run, file ? 'diff' : 'process', file)
    setParams({}, { replace: true })
  }, [run, file, setParams])
}

export function ChatPage() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const me = useSession((s) => s.user)
  const { groups, bots, machines, loaded: workspaceLoaded } = useWorkspace()
  const [groupsState, retryGroups] = useChatData()
  const [creating, setCreating] = useState<GroupKind | null>(null)
  const [binding, setBinding] = useState(false)
  const [newBot, setNewBot] = useState(false)
  const [openBotId, setOpenBotId] = useState<string | null>(null)
  const [machineId, setMachineId] = useState<string | null>(null)
  const openBot = bots.find((b) => b.id === openBotId)
  const openMachine = machines.find((m) => m.id === machineId)
  const group = groups.find((g) => g.id === groupId)
  const railRun = useRunRail((s) => s.runId)
  const preview = usePreview((s) => s.open)
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching groups closes the rail
  useEffect(
    () => () => {
      useRunRail.getState().close()
      usePreview.getState().close()
    },
    [groupId],
  )
  useLinkedRun()
  useEffect(() => {
    if (group) rememberGroup(group.id)
  }, [group])
  // Desktop home resumes the last opened group; mobile home is the conversation list itself.
  useEffect(() => {
    if (groupId || mobile || groupsState !== 'ready' || !groups.length) return
    const target = groups.find((g) => g.id === lastGroup()) ?? groups[0]
    if (target) navigate(`/g/${target.id}`, { replace: true })
  }, [groupId, mobile, groupsState, groups, navigate])

  return (
    <>
      <ChatLayout
        mobileView={groupId ? 'chat' : 'list'}
        rail={
          railRun ? (
            <RunRail key={railRun} runId={railRun} />
          ) : preview ? (
            <PreviewPanel key={preview.attachment.id} target={preview} />
          ) : undefined
        }
        railOpen={!!railRun || !!preview}
        railKind={!railRun && preview ? 'preview' : 'run'}
        sidebar={
          <Sidebar
            groups={groups}
            bots={bots.filter((b) => b.ownerId === me?.id)}
            machines={machines.filter((m) => m.ownerId === me?.id)}
            onNewGroup={() => setCreating('group')}
            onNewDm={() => setCreating('dm')}
            loaded={workspaceLoaded && groupsState === 'ready'}
            onBindMachine={() => setBinding(true)}
            onNewBot={() => setNewBot(true)}
            onOpenBot={setOpenBotId}
            onOpenMachine={setMachineId}
            onConfirmBot={(id) =>
              botsApi
                .confirm(id)
                .then((b) => toast({ type: 'success', message: `${b.name} 已确认` }))
                .catch((e: Error) => toast({ type: 'error', message: e.message }))
            }
          />
        }
      >
        {group ? (
          <ChatView key={group.id} group={group} onBack={mobile ? () => navigate('/') : undefined} />
        ) : groupsState === 'loading' && (groupId || groups.length) ? (
          <div className="chat__placeholder">
            <Spinner />
          </div>
        ) : groupsState === 'error' ? (
          <div className="chat__placeholder">
            <EmptyState
              bare
              illustration={failedArt}
              title="加载失败"
              description="无法获取群列表，请检查网络后重试。"
              actions={
                <Button size="sm" onClick={retryGroups}>
                  重试
                </Button>
              }
            />
          </div>
        ) : (
          <div className="chat__placeholder">
            <EmptyState
              bare
              illustration={groupId ? deniedArt : pickChatArt}
              title={groupId ? '群不存在或你已不在群内' : '选择一个群或私聊开始'}
              description="在左侧选择会话；@ bot 即可让团队成员机器上的 Claude Code / Codex 开始工作。"
            />
          </div>
        )}
      </ChatLayout>
      {creating && me ? <NewGroupDialog me={me} kind={creating} onClose={() => setCreating(null)} /> : null}
      <BindMachineDialog open={binding} onClose={() => setBinding(false)} />
      {newBot && me ? <NewBotDialog me={me} onClose={() => setNewBot(false)} /> : null}
      {openBot && me ? <BotDialog bot={openBot} me={me} onClose={() => setOpenBotId(null)} /> : null}
      {openMachine ? <MachineDialog machine={openMachine} onClose={() => setMachineId(null)} /> : null}
    </>
  )
}
