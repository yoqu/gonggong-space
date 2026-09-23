import { MessagesSquare, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Badge, EmptyState } from '../ui'
import { ChatHeader, ChatLayout, Composer, Timeline } from './ChatLayout'
import { GROUP_MODE_LABEL, Sidebar } from './Sidebar'
import { useSession } from './session'
import { useIsMobile } from './viewport'
import { useWorkspace } from './workspace'

export function ChatPage() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const me = useSession((s) => s.user)
  const { groups, bots, machines } = useWorkspace()
  const [draft, setDraft] = useState('')
  const group = groups.find((g) => g.id === groupId)

  return (
    <ChatLayout
      mobileView={groupId ? 'chat' : 'list'}
      sidebar={
        <Sidebar
          groups={groups}
          bots={bots.filter((b) => b.ownerId === me?.id)}
          machines={machines.filter((m) => m.ownerId === me?.id)}
        />
      }
    >
      {group ? (
        <>
          <ChatHeader
            title={group.name}
            badge={
              group.kind === 'group' ? (
                <Badge variant="secondary">{GROUP_MODE_LABEL[group.mode]}</Badge>
              ) : null
            }
            subtitle={group.repo ? `${group.repo.url} · ${group.repo.branch}` : '托管工作区'}
            onBack={mobile ? () => navigate('/') : undefined}
            actions={
              group.kind === 'group' ? (
                <span className="chat-header__members" title="群成员">
                  <Users size={14} />
                  {group.members.length + group.botIds.length}
                </span>
              ) : (
                <span className="chat-header__note">仅你和你的 bot</span>
              )
            }
          />
          {group.notice ? <div className="chat-notice">{group.notice}</div> : null}
          <Timeline>
            <EmptyState
              bare
              title="还没有消息"
              description="@ 一个 bot 让它开始工作，不 @ 的消息会作为上下文补送。"
            />
          </Timeline>
          <Composer
            value={draft}
            onChange={setDraft}
            hint={mobile ? null : '附件 ≤ 50 MB · 每条 ≤ 10 个 · 不 @ 不触发，会作为上下文补送'}
          />
        </>
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
  )
}
