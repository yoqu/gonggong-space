import {
  type BotDto,
  type DirListingDto,
  type GroupDto,
  type RepoCandidatesDto,
  repoKey,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { AlertDialog, Icon } from '../../ui'
import { repoPath } from '../repos/RepoPicker'
import { type AllowedManagedDir, DirPicker, isManagedRoot, samePath } from './DirPicker'

/** Directories on the caller's machines already holding the group repo, offered before a fresh clone. */
function useLocalPaths(group: GroupDto) {
  const [paths, setPaths] = useState<{ machineId: string; path: string }[]>([])
  useEffect(() => {
    if (!group.repo) return
    api.get<{ machineId: string; path: string }[]>(`/groups/${group.id}/local-paths`).then(setPaths, () => {})
  }, [group.id, group.repo])
  return paths
}

/** Clones of the group repo the bot's machine finds under the home dir, and where a managed clone would go. */
function useCandidates(group: GroupDto, botId: string) {
  const [found, setFound] = useState<RepoCandidatesDto | null>(null)
  useEffect(() => {
    if (!group.repo) return
    api.get<RepoCandidatesDto>(`/groups/${group.id}/bots/${botId}/repo-candidates`).then(setFound, () => {})
  }, [group.id, group.repo, botId])
  return found
}

const normPath = (p: string) => p.replace(/(.)[\\/]+$/, '$1')

/** Ready workspaces already used by other bots of this group on the same machine, grouped by directory path. */
function sameGroupWorkspaces(
  group: GroupDto,
  bot: BotDto & { machineId: string },
  bots: BotDto[],
  states: Record<string, { state: string; path: string | null; workspace: string }> | undefined,
) {
  if (group.mode !== 'partition' || !states) return []
  const mine = states[bot.id]?.path
  const byPath = new Map<string, { path: string; bots: string[]; managed: boolean }>()
  for (const other of bots) {
    if (other.id === bot.id || !group.botIds.includes(other.id) || other.machineId !== bot.machineId) continue
    const s = states[other.id]
    if (s?.state !== 'ready' || !s.path) continue
    if (mine && samePath(s.path, mine)) continue
    const key = normPath(s.path)
    const managed = s.workspace === 'managed' || isManagedRoot(s.path)
    const entry = byPath.get(key)
    if (entry) {
      if (!entry.bots.includes(other.name)) entry.bots.push(other.name)
      entry.managed = entry.managed || managed
    } else {
      byPath.set(key, { path: s.path, bots: [other.name], managed })
    }
  }
  return [...byPath.values()]
}

/**
 * Picks where one of my bots works in this group: a same-group workspace on this machine, a local clone of the repo,
 * a managed clone or directory (`path = null`), the bot's default workspace, or any directory on its machine. Shared by
 * the workspace banner, the repo settings and the bot bar's 更换工作区.
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
  const bots = useWorkspace((s) => s.bots)
  const states = useWorkspace((s) => s.botStates[group.id])
  const found = useCandidates(group, bot.id)
  const remembered = useLocalPaths(group)
    .filter((p) => p.machineId === bot.machineId)
    .map((p) => p.path)
  const shared = sameGroupWorkspaces(group, bot, bots, states)
  const sharedKeys = new Set(shared.map((item) => normPath(item.path)))
  const local = [...new Set([...(found?.paths ?? []), ...remembered])].filter(
    (p) => !sharedKeys.has(normPath(p)),
  )
  const allowedManaged: AllowedManagedDir[] = shared
    .filter((item) => item.managed)
    .map(({ path, bots: names }) => ({ path, bots: names }))
  const hasExisting = shared.length > 0 || local.length > 0
  const [foreign, setForeign] = useState<{ path: string; remote: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const bind = async (path: string | null, force?: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await api.put(`/groups/${group.id}/bots/${bot.id}/workspace`, force ? { path, force } : { path })
      onDone?.()
      onClose()
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }
  // A directory outside the group repo is allowed for this bot only, after a warning. Local (file://) group repos
  // can't be compared here; the daemon keeps checking those.
  const pick = async (path: string) => {
    if (busy) return
    const want = group.repo && repoKey(group.repo.url)
    if (!want) return bind(path)
    setBusy(true)
    try {
      const { git } = await api.get<DirListingDto>(
        `/machines/${bot.machineId}/dirs?path=${encodeURIComponent(path)}`,
      )
      if (git?.remotes.some((u) => repoKey(u) === want)) {
        await api.put(`/groups/${group.id}/bots/${bot.id}/workspace`, { path })
        onDone?.()
        onClose()
        return
      }
      setBusy(false)
      setForeign({ path, remote: git ? (git.remotes[0] ?? t('无 remote')) : t('不是 git 仓库') })
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }

  return (
    <>
      <DirPicker
        machineId={bot.machineId}
        title={t('为 {bot} 选择工作区', { bot: bot.name })}
        start={bot.defaultWorkspace}
        allowedManaged={allowedManaged}
        busy={busy}
        onPick={(path) => void pick(path)}
        onClose={onClose}
        extra={
          <div className="dirpick__choices">
            {shared.map((item) => (
              <button
                key={item.path}
                type="button"
                className="dirpick__choice"
                disabled={busy}
                onClick={() => void bind(item.path)}
              >
                <Icon name="folder-check" size={16} className="dirpick__choice-icon" />
                <span className="dirpick__choice-text">
                  <span className="dirpick__choice-title">
                    {t('复用群内 {bots} 的工作区', { bots: item.bots.join(t('、')) })}
                    <span className="dirpick__badge">{t('免克隆')}</span>
                    <span className="dirpick__badge">{t('推荐')}</span>
                  </span>
                  <span className="dirpick__choice-desc">
                    {t('{path} · 只读并行不打扰，写入时确认', { path: item.path })}
                  </span>
                </span>
              </button>
            ))}
            {local.map((p) => (
              <button
                key={p}
                type="button"
                className="dirpick__choice"
                disabled={busy}
                onClick={() => void bind(p)}
              >
                <Icon name="folder-check" size={16} className="dirpick__choice-icon" />
                <span className="dirpick__choice-text">
                  <span className="dirpick__choice-title">
                    {t('使用本机已有的仓库目录')}
                    <span className="dirpick__badge">{t('免克隆')}</span>
                    {shared.length === 0 ? <span className="dirpick__badge">{t('推荐')}</span> : null}
                  </span>
                  <span className="dirpick__choice-desc">{p}</span>
                </span>
              </button>
            ))}
            {group.repo ? (
              <button
                type="button"
                className="dirpick__choice"
                disabled={busy}
                onClick={() => void bind(null)}
              >
                <Icon name="git-branch" size={16} className="dirpick__choice-icon" />
                <span className="dirpick__choice-text">
                  <span className="dirpick__choice-title">
                    {t('自动克隆群仓库')}
                    {hasExisting ? (
                      <span className="dirpick__badge dirpick__badge--muted">{t('独立目录')}</span>
                    ) : (
                      <span className="dirpick__badge">{t('推荐')}</span>
                    )}
                  </span>
                  <span className="dirpick__choice-desc">
                    {found
                      ? t('克隆 {url} 到 {path}', { url: group.repo.url, path: found.managedPath })
                      : t('在电脑上自动克隆到独立目录，互不干扰')}
                  </span>
                </span>
              </button>
            ) : null}
            {bot.defaultWorkspace ? (
              <button
                type="button"
                className="dirpick__choice"
                disabled={busy}
                onClick={() => bot.defaultWorkspace && void pick(bot.defaultWorkspace)}
              >
                <Icon name="folder-check" size={16} className="dirpick__choice-icon" />
                <span className="dirpick__choice-text">
                  <span className="dirpick__choice-title">{t('使用默认工作区')}</span>
                  <span className="dirpick__choice-desc">{bot.defaultWorkspace}</span>
                </span>
              </button>
            ) : null}
            {group.repo ? null : (
              <button
                type="button"
                className="dirpick__choice"
                disabled={busy}
                onClick={() => void bind(null)}
              >
                <Icon name="folder" size={16} className="dirpick__choice-icon" />
                <span className="dirpick__choice-text">
                  <span className="dirpick__choice-title">{t('使用托管工作区')}</span>
                  <span className="dirpick__choice-desc">
                    {t('共工在电脑上为这个会话单独建的目录，不碰你已有的文件')}
                  </span>
                </span>
              </button>
            )}
            <span className="dirpick__or">{t('或选择电脑上已有的目录')}</span>
          </div>
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
              <li>{t('群的基准分支与自动克隆对 {bot} 不再生效', { bot: bot.name })}</li>
              <li>{t('仅影响 {bot}，群内其他 Bot 不变', { bot: bot.name })}</li>
            </ul>
          }
          onClose={() => {
            if (!busy) setForeign(null)
          }}
          actions={[
            { label: t('取消'), disabled: busy, onClick: () => setForeign(null) },
            {
              label: t('仍然使用'),
              variant: 'primary',
              disabled: busy,
              loading: busy,
              onClick: () => void bind(foreign.path, true),
            },
          ]}
        />
      ) : null}
    </>
  )
}
