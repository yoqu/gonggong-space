import {
  type GitActionResultDetail,
  type GitBranch,
  type GitRemote,
  PROTOCOL_VERSION,
  type ServerToDaemon,
} from '@gonggong/protocol'
import { and, asc, eq } from 'drizzle-orm'
import { expect } from 'vitest'
import { groupBots, groupRepos, messages, runs } from '../../src/db/schema.js'
import { inbox, type TestApp } from './app.js'
import { client } from './http.js'

type GitAsk = Extract<ServerToDaemon, { t: `git.${string}` }>

/** A daemon on a real socket whose git requests the test answers; `features` as sent in its hello. */
export async function gitDaemon(t: TestApp, token: string, features = ['gitOps', 'gitOps2']) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  send({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    token,
    daemonVersion: '0.1.0',
    machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
    agents: [],
    features,
  })
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  /** The next git request; hello may first trigger workspace messages. */
  const next = async <T extends GitAsk['t']>(type: T) => {
    for (;;) {
      const m = await box.next<ServerToDaemon>()
      if (m.t === type) return m as Extract<GitAsk, { t: T }>
    }
  }
  /** Answers the next git.action with ok / busy, and a detail when given (gitOps4). */
  const act = async (
    o: {
      ok?: boolean
      busy?: boolean
      output?: string | null
      error?: string | null
      detail?: GitActionResultDetail
    } = {},
  ) => {
    const req = await next('git.action')
    send({
      t: 'git.action.result',
      requestId: req.requestId,
      ok: o.ok ?? true,
      busy: o.busy ?? false,
      output: o.output ?? 'done',
      error: o.error ?? null,
      ...(o.detail && { detail: o.detail }),
    })
    return req
  }
  /** Answers the next git.refs with these branches and remotes, or `error`. */
  const refs = async (o: { branches?: GitBranch[]; remotes?: string[]; error?: string | null } = {}) => {
    const req = await next('git.refs')
    send({
      t: 'git.refs.result',
      requestId: req.requestId,
      branches: o.branches ?? [],
      remotes: (o.remotes ?? []).map((name): GitRemote => ({ name, url: `git@git.corp:${name}/pay.git` })),
      tags: [],
      recent: [],
      error: o.error ?? null,
    })
    return req
  }
  return { send, next, act, refs, close: () => ws.close() }
}

/** A branch as git.refs lists it: `upstream` given = a local branch tracking it. */
export const gitBranch = (
  name: string,
  kind: GitBranch['kind'] = 'local',
  upstream: string | null = null,
) => ({
  name,
  kind,
  current: false,
  upstream,
  ahead: upstream ? 0 : null,
  behind: upstream ? 0 : null,
  commit: 'a1b2c3d',
  subject: 's',
  at: '2026-10-24T08:00:00+08:00',
})

/** A partition group with a repo (base `main`) and the bot cc of 王磊, ready; 陈晨 is a member. */
export async function gitWorld(t: TestApp) {
  const owner = await t.seed.user({ name: '王磊' })
  const member = await t.seed.user({ name: '陈晨' })
  const outsider = await t.seed.user({ name: '路人' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: 'cc', machineId: machine.id })
  const group = await t.seed.group({ createdBy: owner.id, memberIds: [member.id], botIds: [bot.id] })
  await t.db
    .insert(groupRepos)
    .values({ groupId: group.id, url: 'git@git.corp:pay/pay.git', baseBranch: 'main' })
  await t.db
    .update(groupBots)
    .set({ workspaceState: 'ready', workspacePath: '/w/pay' })
    .where(eq(groupBots.groupId, group.id))
  const owners = client(t, await t.seed.cookie(owner.id))
  const members = client(t, await t.seed.cookie(member.id))
  const outsiders = client(t, await t.seed.cookie(outsider.id))
  const base = `/api/groups/${group.id}/bots/${bot.id}/git`
  const run = async (status: string, groupId = group.id, botId = bot.id) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId, kind: 'user', authorUserId: owner.id, body: '@cc' })
      .returning()
    await t.db
      .insert(runs)
      .values({ groupId, botId, triggerMessageId: m!.id, originUserId: owner.id, status })
  }
  return { owner, member, outsider, machine, token, bot, group, owners, members, outsiders, base, run }
}

/** The group's system event lines, oldest first. */
export const groupEvents = async (t: TestApp, groupId: string) =>
  (
    await t.db
      .select({ body: messages.body })
      .from(messages)
      .where(and(eq(messages.groupId, groupId), eq(messages.kind, 'event')))
      .orderBy(asc(messages.seq))
  ).map((m) => m.body)
