import type { BotDto, GroupDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Icon, toast } from '../../ui'
import { DirPicker } from './DirPicker'

/** Directories on the caller's machines already holding the group repo, offered before a fresh clone. */
function useLocalPaths(group: GroupDto) {
  const [paths, setPaths] = useState<{ machineId: string; path: string }[]>([])
  useEffect(() => {
    if (!group.repo) return
    api.get<{ machineId: string; path: string }[]>(`/groups/${group.id}/local-paths`).then(setPaths, () => {})
  }, [group.id, group.repo])
  return paths
}

/**
 * Picks where one of my bots works in this group: a local clone of the repo, a managed clone (`path = null`), the
 * bot's default workspace, or any directory on its machine. Shared by the workspace banner and the repo settings.
 */
export function WorkspacePicker({
  group,
  bot,
  onDone,
  onClose,
}: {
  group: GroupDto
  bot: BotDto & { machineId: string }
  onDone?: () => void
  onClose: () => void
}) {
  const local = useLocalPaths(group).filter((p) => p.machineId === bot.machineId)
  const bind = (path: string | null) =>
    api
      .put(`/groups/${group.id}/bots/${bot.id}/workspace`, { path })
      .then(() => {
        onDone?.()
        onClose()
      })
      .catch((e: Error) => toast({ type: 'error', message: e.message }))

  return (
    <DirPicker
      machineId={bot.machineId}
      title={`为 ${bot.name} 选择工作区`}
      start={bot.defaultWorkspace}
      onPick={(path) => void bind(path)}
      onClose={onClose}
      extra={
        bot.defaultWorkspace || group.repo ? (
          <div className="dirpick__choices">
            {local.map((p) => (
              <button
                key={p.path}
                type="button"
                className="dirpick__choice"
                onClick={() => void bind(p.path)}
              >
                <Icon name="folder-check" size={16} className="dirpick__choice-icon" />
                <span className="dirpick__choice-text">
                  <span className="dirpick__choice-title">
                    使用本机已有的仓库目录<span className="dirpick__badge">免 clone</span>
                  </span>
                  <span className="dirpick__choice-desc">{p.path}</span>
                </span>
              </button>
            ))}
            {group.repo ? (
              <button type="button" className="dirpick__choice" onClick={() => void bind(null)}>
                <Icon name="git-branch" size={16} className="dirpick__choice-icon" />
                <span className="dirpick__choice-text">
                  <span className="dirpick__choice-title">
                    托管克隆群仓库<span className="dirpick__badge">推荐</span>
                  </span>
                  <span className="dirpick__choice-desc">在机器上自动克隆到独立目录，互不干扰</span>
                </span>
              </button>
            ) : null}
            {bot.defaultWorkspace ? (
              <button
                type="button"
                className="dirpick__choice"
                onClick={() => void bind(bot.defaultWorkspace)}
              >
                <Icon name="folder-check" size={16} className="dirpick__choice-icon" />
                <span className="dirpick__choice-text">
                  <span className="dirpick__choice-title">使用默认工作区</span>
                  <span className="dirpick__choice-desc">{bot.defaultWorkspace}</span>
                </span>
              </button>
            ) : null}
            <span className="dirpick__or">或选择机器上已有的目录</span>
          </div>
        ) : null
      }
    />
  )
}
