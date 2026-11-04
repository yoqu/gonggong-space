import {
  type BotDto,
  EXTRA_DIRS_MAX,
  type GroupBotStateDto,
  type GroupDto,
  type RepoStatus,
} from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { Button, Icon, IconButton, Presence, Tag } from '../../ui'
import { groupsApi } from '../groups/api'
import { DirPicker } from '../workspaces/DirPicker'
import { repoPath } from './RepoPicker'
import { middle, repoIcon } from './repo-access'

type Picking = { kind: 'dir' } | { kind: 'repo'; id: string; name: string }

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
const trimmed = (path: string) => path.replace(/(.)[\\/]+$/, '$1')

/** Branch, ↓incoming ↑outgoing and uncommitted changes of one workspace, as its daemon last reported them. */
function RepoGit({ s }: { s: RepoStatus | undefined }) {
  if (!s) return null
  return (
    <span className="rw-git">
      {s.branch ? <span className="rw-git__branch">{s.branch}</span> : null}
      {s.behind ? (
        <span className="rw-git__in" role="img" aria-label={t('落后 {n} 个提交', { n: s.behind })}>
          ↓{s.behind}
        </span>
      ) : null}
      {s.ahead ? (
        <span className="rw-git__out" role="img" aria-label={t('领先 {n} 个提交', { n: s.ahead })}>
          ↑{s.ahead}
        </span>
      ) : null}
      {s.dirty ? <Tag tone="orange">{t('未提交')}</Tag> : null}
    </span>
  )
}

/**
 * A bot's workspaces besides the main one: its clone of each extra repo (managed, or the owner's own) and its own
 * directories. Only the owner changes them; any change starts a new session from the next turn.
 */
export function BotWorkspaces({
  group,
  bot,
  state,
  mine,
  online,
}: {
  group: GroupDto
  bot: BotDto
  state: GroupBotStateDto | undefined
  mine: boolean
  online: boolean
}) {
  const [picking, setPicking] = useState<Picking | null>(null)
  const extras = group.extraRepos ?? []
  const dirs = state?.extraDirs ?? []
  const repoPaths = state?.repoPaths ?? {}
  const browsable = mine && online && !!bot.machineId
  const offline = online ? undefined : t('离线，上线后可更改')
  const setDirs = (next: string[]) => attempt(() => groupsApi.setBotExtraDirs(group.id, bot.id, next))
  // Repo-less groups: the main workspace is just one of the bot's directories, so another can take its place.
  const makeMain = async (dir: string) => {
    if (!(await attempt(() => groupsApi.bindWorkspace(group.id, bot.id, dir)))) return
    const old = state?.workspace === 'cd' && state.path ? [state.path] : []
    await setDirs([...dirs.filter((d) => d !== dir), ...old])
  }
  // Extra directories are reported as `extra` repos named by their path; a managed clone's path holds its repo id.
  const extraRepos = state?.git?.repos.filter((r) => r.kind === 'extra') ?? []
  const atPath = (dir: string) => extraRepos.find((r) => trimmed(r.path) === trimmed(dir))
  const ofRepo = (id: string) => extraRepos.find((r) => r.path.split(/[\\/]/).includes(id))
  const sync = group.mode === 'force' ? <Tag tone="gray">{t('不参与同步')}</Tag> : null

  if (!extras.length && !dirs.length && !mine) return null
  return (
    <>
      {extras.map((r) => {
        const local = repoPaths[r.id]
        return (
          <div key={r.id} className="rw-ws" data-testid={`rw-ws-${bot.id}-${r.id}`}>
            <Icon name={repoIcon(r.url)} size={14} />
            <span className="rw-ws__main">
              <span className="rw-ws__name">
                {repoPath(r.url)}
                {sync}
                <RepoGit s={local ? atPath(local) : ofRepo(r.id)} />
              </span>
              <span className="rw-ws__sub">
                {local ? (
                  <span className="rw-path" title={local}>
                    {middle(local)}
                  </span>
                ) : (
                  t('托管克隆 · {branch}', { branch: r.branch })
                )}
              </span>
            </span>
            {mine ? (
              local ? (
                <Button
                  size="small"
                  variant="plain"
                  onClick={() => void attempt(() => groupsApi.setRepoPath(group.id, bot.id, r.id, null))}
                >
                  {t('改回托管')}
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="plain"
                  disabled={!browsable}
                  title={offline}
                  onClick={() => setPicking({ kind: 'repo', id: r.id, name: repoPath(r.url) })}
                >
                  {t('改用本机克隆…')}
                </Button>
              )
            ) : null}
          </div>
        )
      })}
      {dirs.map((d) => (
        <div key={d} className="rw-ws" data-testid={`rw-dir-${bot.id}`}>
          <Icon name="folder" size={14} />
          <span className="rw-ws__main">
            <span className="rw-ws__name">
              {baseName(d)}
              <Tag tone="gray">{t('自带目录')}</Tag>
              {sync}
              <RepoGit s={atPath(d)} />
            </span>
            <span className="rw-ws__sub rw-path" title={d}>
              {middle(d)}
            </span>
          </span>
          {mine && !group.repo && group.mode === 'partition' ? (
            <Button
              size="small"
              variant="plain"
              disabled={!browsable}
              title={offline}
              onClick={() => void makeMain(d)}
            >
              {t('设为主工作区')}
            </Button>
          ) : null}
          {mine ? (
            <IconButton
              size="small"
              title={t('移除 {name}', { name: d })}
              onClick={() => void setDirs(dirs.filter((x) => x !== d))}
            >
              {'minus' as const}
            </IconButton>
          ) : null}
        </div>
      ))}
      {mine ? (
        <div className="rw-ws rw-ws--add">
          <Button
            size="small"
            variant="plain"
            icon="plus"
            disabled={!browsable || dirs.length >= EXTRA_DIRS_MAX}
            title={offline}
            onClick={() => setPicking({ kind: 'dir' })}
          >
            {t('添加目录…')}
          </Button>
        </div>
      ) : null}
      <Presence>
        {picking && bot.machineId ? (
          <DirPicker
            machineId={bot.machineId}
            title={
              picking.kind === 'dir'
                ? t('为 {bot} 添加自带目录', { bot: bot.name })
                : t('选择 {repo} 在本机的克隆', { repo: picking.name })
            }
            onPick={(path) => {
              setPicking(null)
              void attempt(() =>
                picking.kind === 'dir'
                  ? groupsApi.setBotExtraDirs(group.id, bot.id, [...new Set([...dirs, path])])
                  : groupsApi.setRepoPath(group.id, bot.id, picking.id, path),
              )
            }}
            onClose={() => setPicking(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}
