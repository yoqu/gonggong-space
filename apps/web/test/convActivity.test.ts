import type { LiveRun } from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
import { activityOf, levelOf, needsMe } from '../src/app/convActivity'

const run = (id: string, status: LiveRun['status'], o: Partial<LiveRun> = {}): LiveRun => ({
  id,
  botId: `bot-${id}`,
  status,
  needsMe: false,
  ...o,
})

describe('conversation activity', () => {
  it('ranks 待我审批 > 待回答 > 等他人审批 > 运行中 > 排队中', () => {
    expect(
      [
        run('q', 'queued'),
        run('r', 'running'),
        run('o', 'awaiting_approval'),
        run('a', 'awaiting_answer'),
        run('m', 'awaiting_approval', { needsMe: true }),
      ].map(levelOf),
    ).toEqual(['queued', 'running', 'approve_other', 'answer', 'approve_me'])
  })

  it('shows the top state with the other runs counted, up to 3 figures and +N', () => {
    const a = activityOf([
      run('r1', 'running'),
      run('q', 'queued'),
      run('m', 'awaiting_approval', { needsMe: true, title: 'rm -rf build' }),
      run('r2', 'running'),
      run('o', 'awaiting_approval'),
    ])
    expect(a).toMatchObject({
      tone: 'orange',
      label: '待审批',
      title: '待审批 · 4 个运行中',
      more: 2,
      alert: { flag: '[待审批] ', botId: 'bot-m', title: 'rm -rf build' },
    })
    expect(a?.actors).toEqual([
      { runId: 'm', botId: 'bot-m', action: 'raise' },
      { runId: 'o', botId: 'bot-o', action: 'raise' },
      { runId: 'r1', botId: 'bot-r1', action: 'carry' },
    ])
  })

  it('tones and labels each level; only the viewer’s own wait raises an alert', () => {
    expect(activityOf([])).toBeNull()
    expect(activityOf([run('r', 'running')])).toMatchObject({ tone: 'blue', label: '运行中', alert: null })
    expect(activityOf([run('r', 'running'), run('s', 'running')])).toMatchObject({
      label: '运行中',
      title: '2 个运行中',
    })
    expect(activityOf([run('q', 'queued')])).toMatchObject({ tone: 'blue', label: '排队中' })
    expect(activityOf([run('o', 'awaiting_approval')])).toMatchObject({
      tone: 'gray',
      label: '等待审批',
      alert: null,
    })
    expect(activityOf([run('a', 'awaiting_answer')])).toMatchObject({
      tone: 'orange',
      label: '待回答',
      alert: null,
    })
    expect(activityOf([run('a', 'awaiting_answer', { needsMe: true, title: '用哪个库？' })])?.alert).toEqual({
      flag: '[待回答] ',
      botId: 'bot-a',
      title: '用哪个库？',
    })
    expect([
      needsMe([run('r', 'running')]),
      needsMe([run('a', 'awaiting_answer', { needsMe: true })]),
    ]).toEqual([false, true])
  })
})

describe('still costumes', () => {
  it('hold their pose regardless of the motion preference', async () => {
    const { roleCostume } = await import('../src/features/bots/avatars')
    const scene = (still?: boolean) =>
      decodeURIComponent(roleCostume('role-focus').scene('carry', false, still))
    expect(scene(true)).toContain('</style>'.replace('</style>', '*{animation:none!important}</style>'))
    expect(scene()).toContain('@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>')
  })
})
