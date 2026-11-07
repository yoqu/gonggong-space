import { randomUUID } from 'node:crypto'
import { repoName } from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import type { MessageKey } from '../../i18n/index.js'
import { fail, HttpError } from '../../lib/errors.js'
import { postEvent } from '../messages/service.js'
import { ensureWorkspace, onlineMachine } from './provision.js'
import { botDirs, RESET_SESSION, updateBotState } from './state.js'

const DIR_TIMEOUT_MS = 10_000

/** dir.list on a machine; fails when it is offline, silent or reports an error. */
export async function listDirs(
  ctx: Ctx,
  m: { name: string; machineId: string | null },
  path: string | null,
  offline: MessageKey,
  hidden = false,
) {
  const machineId = onlineMachine(ctx, m.machineId)
  if (!machineId) return fail('conflict', offline, { name: m.name })
  const ask = { t: 'dir.list', requestId: randomUUID(), path, hidden } as const
  const res =
    (await ctx.hub.request(machineId, ask, 'dir.result', DIR_TIMEOUT_MS)) ??
    fail('conflict', '{name} 未响应，请稍后重试', { name: m.name })
  if (res.error) throw new HttpError('invalid', res.error)
  return res
}

/**
 * Points a bot at its owner's clone of an extra repo (checked by the caller), or back to a managed clone with null.
 * Its session starts over, as with any change of what it works in.
 */
export async function setRepoPath(
  ctx: Ctx,
  o: {
    groupId: string
    user: { name: string }
    bot: { id: string; name: string; machineId: string | null }
    repo: { id: string; url: string }
    path: string | null
  },
) {
  const { repoPaths } = await botDirs(ctx, o.groupId, o.bot.id)
  const path = o.path && o.path.replace(/(.)[\\/]+$/, '$1')
  if ((repoPaths[o.repo.id] ?? null) === path) return
  const { [o.repo.id]: _, ...rest } = repoPaths
  await updateBotState(ctx, o.groupId, o.bot.id, {
    repoPaths: path === null ? rest : { ...rest, [o.repo.id]: path },
    ...RESET_SESSION,
    newSessionReason: 'config_changed',
  })
  await postEvent(
    ctx,
    o.groupId,
    path === null
      ? '{user} 让 {bot} 在本群改回自动克隆的 {repo}'
      : '{user} 让 {bot} 在本群改用本机的 {repo}：{path}',
    { user: o.user.name, bot: o.bot.name, repo: repoName(o.repo.url), path: path ?? '' },
  )
  // The managed clone may never have been made, or was made for an older branch.
  if (path === null) await ensureWorkspace(ctx, o.groupId, o.bot)
}
