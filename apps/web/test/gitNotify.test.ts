import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gitOperationSettled, wordSettled } from '../src/features/git/notify'
import { useToasts } from '../src/ui/toast'
import { op, setMe, toasts } from './gitFixtures'

const BOTS = [{ id: 'b1', name: '小王的 Claude' }]

describe('git operation notices', () => {
  beforeEach(() => {
    setMe('u2')
    useToasts.setState({ items: [] })
  })

  it("words a success the caller's way even when the realtime event comes before the POST answer", () => {
    const committed = vi.fn()
    wordSettled('g1', 'b1', 'commit', committed)
    const done = op({ id: 'c1', action: 'commit', status: 'succeeded', message: 'fix: 退款' })
    gitOperationSettled(done, BOTS)
    gitOperationSettled(done, BOTS, committed)
    expect(committed).toHaveBeenCalledTimes(1)
    expect(toasts()).toEqual([])
  })

  it('forgets the wording once the operation settled, and when told to', () => {
    const committed = vi.fn()
    wordSettled('g1', 'b1', 'commit', committed)
    gitOperationSettled(op({ id: 'c2', action: 'commit', status: 'failed', error: 'boom' }), BOTS)
    gitOperationSettled(op({ id: 'c3', action: 'commit', status: 'succeeded' }), BOTS)
    wordSettled('g1', 'b1', 'push', committed)
    wordSettled('g1', 'b1', 'push')
    gitOperationSettled(op({ id: 'p1', action: 'push', status: 'succeeded' }), BOTS)
    expect(committed).not.toHaveBeenCalled()
    expect(toasts()).toHaveLength(3)
  })
})
