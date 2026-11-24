import type { UserDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import {
  clearPending,
  type PendingMessage,
  restorePending,
  reusedClientId,
  type SendBody,
  sendPending,
  usePending,
} from '../src/features/chat/pending'
import { apiError, mockApi } from './mockApi'

const user = (id: string): UserDto => ({
  id,
  account: id,
  name: id,
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
})

const req = (o: Partial<SendBody> = {}): SendBody => ({
  body: '你好',
  clientId: 'c1',
  attachmentIds: [],
  quote: null,
  appendTo: null,
  ...o,
})

const pending = (o: Partial<SendBody> = {}): PendingMessage => ({
  groupId: 'g1',
  owner: 'u1',
  req: req(o),
  draft: { quote: null, uploads: [], append: null, picks: {}, alsoSent: false },
  status: 'failed',
})

const { clientId: _, ...bare } = req()

beforeEach(() => {
  localStorage.removeItem('gg.team')
  useSession.setState({ user: user('u1'), status: 'ready' })
  usePending.setState({ list: [], back: null, reusable: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('pending sends across sessions', () => {
  it('drops a backoff retry once its account logs out, never posting it with the next session', async () => {
    const calls = mockApi({
      'POST /groups/g1/messages': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const onSent = vi.fn()
    const done = sendPending({ groupId: 'g1', req: req(), draft: pending().draft }, onSent)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    clearPending()
    useSession.setState({ user: user('u2') })
    await done
    expect(calls).toHaveLength(1)
    expect(onSent).not.toHaveBeenCalled()
    expect(usePending.getState().list).toEqual([])
  })

  it('leaves a send cut off by an expired session as failed for the same account to resend, not stuck sending', async () => {
    const calls = mockApi({
      'POST /groups/g1/messages': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const done = sendPending({ groupId: 'g1', req: req(), draft: pending().draft }, vi.fn())
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    useSession.setState({ user: null })
    await done
    useSession.setState({ user: user('u1') })
    expect(usePending.getState().list.map((p) => p.status)).toEqual(['failed'])
    expect(calls).toHaveLength(1)
  })

  it('keeps sending when another tab switches team: rows are per group', async () => {
    let n = 0
    mockApi({
      'POST /groups/g1/messages': () => {
        if (n++ === 0) throw new TypeError('Failed to fetch')
        return { id: 'm1', seq: 1 }
      },
    })
    const onSent = vi.fn()
    const done = sendPending({ groupId: 'g1', req: req(), draft: pending().draft }, onSent)
    localStorage.setItem('gg.team', 't2')
    await done
    expect(onSent).toHaveBeenCalled()
  })

  it('stops retrying when the account switches without logging out', async () => {
    const calls = mockApi({
      'POST /groups/g1/messages': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const done = sendPending({ groupId: 'g1', req: req(), draft: pending().draft }, vi.fn())
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    useSession.setState({ user: user('u2') })
    await done
    expect(calls).toHaveLength(1)
  })

  it('ignores the reply of a send that was in flight when the account logged out', async () => {
    let reply: (r: Response) => void = () => {}
    mockApi({ 'POST /groups/g1/messages': () => new Promise<Response>((r) => (reply = r)) })
    const onSent = vi.fn()
    const done = sendPending({ groupId: 'g1', req: req(), draft: pending().draft }, onSent)
    clearPending()
    reply(apiError(400, 'invalid'))
    await done
    expect(onSent).not.toHaveBeenCalled()
    expect(usePending.getState().back).toBeNull()
  })
})

describe('reusing the clientId of a message taken back', () => {
  it('reuses it only for the very same request, once', () => {
    restorePending(pending())
    expect(reusedClientId('g1', { ...bare, quote: { kind: 'message', id: 'm1' } })).toBeNull()
    expect(reusedClientId('g1', { ...bare, runOptions: { b1: { model: 'x' } } })).toBeNull()
    expect(reusedClientId('g1', { ...bare, appendTo: 'r1' })).toBeNull()
    expect(reusedClientId('g2', bare)).toBeNull()
    expect(reusedClientId('g1', { ...bare })).toBe('c1')
    expect(reusedClientId('g1', bare)).toBeNull()
  })

  it("is the leaving account's and goes on logout", () => {
    restorePending(pending())
    useSession.setState({ user: user('u2') })
    expect(reusedClientId('g1', bare)).toBeNull()
    useSession.setState({ user: user('u1') })
    clearPending()
    expect(reusedClientId('g1', bare)).toBeNull()
  })
})
