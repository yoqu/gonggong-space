import type { GroupDto } from '@aiws/protocol'
import { MessagesSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { PreviewPanel } from '../features/attachments/PreviewPanel'
import { usePreview } from '../features/attachments/preview'
import { BotDialog } from '../features/bots/BotDialog'
import { botsApi } from '../features/bots/model'
import { NewBotDialog } from '../features/bots/NewBotDialog'
import { ChatView } from '../features/chat/ChatView'
import { type GroupKind, NewGroupDialog } from '../features/chat/NewGroupDialog'
import { BindMachineDialog } from '../features/machines/BindMachineDialog'
import { RevokeMachineDialog } from '../features/machines/RevokeMachineDialog'
import { RunRail } from '../features/runs/RunRail'
import { useRunRail } from '../features/runs/rail'
import { api } from '../lib/api'
import { realtime } from '../lib/realtime'
import { EmptyState, Spinner, toast } from '../ui'
import { ChatLayout } from './ChatLayout'
import { Sidebar } from './Sidebar'
import { useSession } from './session'
import { useIsMobile } from './viewport'
import { useWorkspace } from './workspace'

/** Loads my groups; reloads after a realtime reconnect to catch up. */
function useChatData() {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const load = () => {
      api.get<GroupDto[]>('/groups').then(
        (groups) => {
          useWorkspace.setState({ groups })
          setLoaded(true)
        },
        () => setLoaded(true),
      )
    }
    load()
    let wasOpen = realtime.getStatus() === 'open'
    return realtime.onStatus((st) => {
      if (st === 'open' && wasOpen) load()
      if (st === 'open') wasOpen = true
    })
  }, [])
  return loaded
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
  const loaded = useChatData()
  const [creating, setCreating] = useState<GroupKind | null>(null)
  const [binding, setBinding] = useState(false)
  const [newBot, setNewBot] = useState(false)
  const [openBotId, setOpenBotId] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const openBot = bots.find((b) => b.id === openBotId)
  const revoking = machines.find((m) => m.id === revokeId)
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
        railClass={!railRun && preview ? 'chat__rail--preview' : undefined}
        sidebar={
          <Sidebar
            groups={groups}
            bots={bots.filter((b) => b.ownerId === me?.id)}
            machines={machines.filter((m) => m.ownerId === me?.id)}
            onNewGroup={() => setCreating('group')}
            onNewDm={() => setCreating('dm')}
            loaded={workspaceLoaded}
            onBindMachine={() => setBinding(true)}
            onNewBot={() => setNewBot(true)}
            onOpenBot={setOpenBotId}
            onRevokeMachine={setRevokeId}
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
        ) : groupId && !loaded ? (
          <div className="chat__placeholder">
            <Spinner />
          </div>
        ) : (
          <div className="chat__placeholder">
            <EmptyState
              bare
              icon={<MessagesSquare size={28} />}
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
      {revoking ? <RevokeMachineDialog machine={revoking} onClose={() => setRevokeId(null)} /> : null}
    </>
  )
}
