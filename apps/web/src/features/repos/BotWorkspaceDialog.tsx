import type { BotDto, GroupBotStateDto, GroupDto, RepoAccessReason } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Button, Dialog, GroupBox, Icon, Presence, Tag } from '../../ui'
import { WorkspacePicker } from '../workspaces/WorkspacePicker'
import { BotWorkspaces, RepoGit } from './BotWorkspaces'
import { repoPath } from './RepoPicker'
import { middle, repoIcon } from './repo-access'

const PAUSING: Partial<Record<RepoAccessReason, string>> = {
  denied: t('无权限'),
  network: t('网络或证书'),
  timeout: t('超时'),
}

export const botOnline = (b: BotDto) => b.presence !== 'offline' && b.binding === 'bound'

export const isPaused = (s: GroupBotStateDto | undefined) =>
  s?.state === 'failed' && !!s.reason && !!PAUSING[s.reason]

/** What keeps the bot from working in this group until someone acts; reported states only, so unloaded ones stay quiet. */
export function blocker(s: GroupBotStateDto | undefined): string | null {
  if (!s) return null
  if (s.state === 'unbound') return t('未选择工作区')
  if (s.state === 'confirm') return t('待主人确认')
  if (s.state !== 'failed') return null
  const paused = s.reason && PAUSING[s.reason]
  return paused ? t('已暂停 · {reason}', { reason: paused }) : (s.error ?? t('失败'))
}

/** Where the bot's main workspace stands. */
export function workspaceText(s: GroupBotStateDto | undefined, online: boolean) {
  if (!s) return t('未选择工作区')
  const blocked = blocker(s)
  if (blocked) return blocked
  if (s.workspace === 'cd' && s.path) return <span className="rw-path">{middle(s.path)}</span>
  if (s.state === 'ready') return t('自动克隆 · 就绪')
  if (s.state === 'pending' && !online) return t('等待上线')
  return t('克隆中…')
}

/** Everywhere one bot works in this group: the main workspace, extra repos and directories. Only its owner edits. */
export function BotWorkspaceDialog({
  group,
  bot,
  onClose,
}: {
  group: GroupDto
  bot: BotDto
  onClose: () => void
}) {
  const me = useSession((s) => s.user)
  const s = useWorkspace((st) => st.botStates[group.id]?.[bot.id])
  const [picking, setPicking] = useState(false)
  const mine = bot.ownerId === me?.id
  const online = botOnline(bot)
  return (
    <Dialog
      open
      width={560}
      title={t('{bot} 的工作区', { bot: bot.name })}
      onClose={onClose}
      footer={
        <>
          <span className="gs-desc">
            {!mine
              ? t('仅 Bot 主人 {owner} 可修改', { owner: bot.ownerName })
              : online
                ? t('改动从下一轮起生效并开始新会话')
                : t('机器离线，上线后可更改')}
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>{t('完成')}</Button>
        </>
      }
    >
      <GroupBox>
        <div className="rw-ws rw-ws--main" data-testid={`rw-bot-${bot.id}`}>
          <Icon name={group.repo ? repoIcon(group.repo.url) : 'folder'} size={14} />
          <span className="rw-ws__main">
            <span className="rw-ws__name">
              {group.repo ? repoPath(group.repo.url) : t('主目录')}
              <Tag tone="blue">{t('主#repo')}</Tag>
              <RepoGit s={s?.git} />
            </span>
            <span className="rw-ws__sub">{workspaceText(s, online)}</span>
          </span>
          {mine ? (
            <Button size="small" disabled={!online || !bot.machineId} onClick={() => setPicking(true)}>
              {s?.state === 'confirm' ? t('确认…') : t('更改…')}
            </Button>
          ) : null}
        </div>
        <BotWorkspaces group={group} bot={bot} state={s} mine={mine} online={online} />
      </GroupBox>
      <Presence>
        {picking && bot.machineId ? (
          <WorkspacePicker
            group={group}
            bot={{ ...bot, machineId: bot.machineId }}
            onClose={() => setPicking(false)}
          />
        ) : null}
      </Presence>
    </Dialog>
  )
}
