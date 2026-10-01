import { type BotDto, type DirListingDto, type GroupDto, repoKey } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { AlertDialog, Icon } from '../../ui'
import { repoPath } from '../repos/RepoPicker'
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
  const [foreign, setForeign] = useState<{ path: string; remote: string } | null>(null)
  const bind = (path: string | null, force?: boolean) =>
    api
      .put(`/groups/${group.id}/bots/${bot.id}/workspace`, force ? { path, force } : { path })
      .then(() => {
        onDone?.()
        onClose()
      })
      .catch(toastError)
  // A directory outside the group repo is allowed for this bot only, after a warning. Local (file://) group repos
  // can't be compared here; the daemon keeps checking those.
  const pick = async (path: string) => {
    const want = group.repo && repoKey(group.repo.url)
    if (!want) return bind(path)
    try {
      const { git } = await api.get<DirListingDto>(
        `/machines/${bot.machineId}/dirs?path=${encodeURIComponent(path)}`,
      )
      if (git?.remotes.some((u) => repoKey(u) === want)) return bind(path)
      setForeign({ path, remote: git ? (git.remotes[0] ?? t('无 remote')) : t('不是 git 仓库') })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <>
      <DirPicker
        machineId={bot.machineId}
        title={t('为 {bot} 选择工作区', { bot: bot.name })}
        start={bot.defaultWorkspace}
        onPick={(path) => void pick(path)}
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
                      {t('使用本机已有的仓库目录')}
                      <span className="dirpick__badge">{t('免 clone')}</span>
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
                      {t('托管克隆群仓库')}
                      <span className="dirpick__badge">{t('推荐')}</span>
                    </span>
                    <span className="dirpick__choice-desc">{t('在机器上自动克隆到独立目录，互不干扰')}</span>
                  </span>
                </button>
              ) : null}
              {bot.defaultWorkspace ? (
                <button
                  type="button"
                  className="dirpick__choice"
                  onClick={() => bot.defaultWorkspace && void pick(bot.defaultWorkspace)}
                >
                  <Icon name="folder-check" size={16} className="dirpick__choice-icon" />
                  <span className="dirpick__choice-text">
                    <span className="dirpick__choice-title">{t('使用默认工作区')}</span>
                    <span className="dirpick__choice-desc">{bot.defaultWorkspace}</span>
                  </span>
                </button>
              ) : null}
              <span className="dirpick__or">{t('或选择机器上已有的目录')}</span>
            </div>
          ) : null
        }
      />
      {foreign && group.repo ? (
        <AlertDialog
          open
          title={t('该目录不是群仓库')}
          message={t('{bot} 将在 {path} 工作，不再使用群仓库 {repo}。', {
            bot: bot.name,
            path: foreign.path,
            repo: repoPath(group.repo.url),
          })}
          detail={
            <ul className="ui-consequences">
              <li>{t('目录 remote：{remote}', { remote: foreign.remote })}</li>
              <li>{t('群的基准分支与托管克隆对 {bot} 不再生效', { bot: bot.name })}</li>
              <li>{t('仅影响 {bot}，群内其他 Bot 不变', { bot: bot.name })}</li>
            </ul>
          }
          onClose={() => setForeign(null)}
          actions={[
            { label: t('取消'), onClick: () => setForeign(null) },
            { label: t('仍然使用'), variant: 'primary', onClick: () => void bind(foreign.path, true) },
          ]}
        />
      ) : null}
    </>
  )
}
