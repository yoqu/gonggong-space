import { describe, expect, it } from 'vitest'
import {
  CreateScheduleReq,
  createTranslator,
  describeSchedule,
  formatInZone,
  protocolEn,
  ScheduleCreateArgs,
  ScheduleUpdateArgs,
  UpdateScheduleReq,
} from '../src/index.js'

const zh = createTranslator('zh', protocolEn).text
const en = createTranslator('en', protocolEn).text
const said = (s: Parameters<typeof describeSchedule>[0]) => zh(describeSchedule(s))

describe('schedules', () => {
  const base = { name: '日报', prompt: '汇总昨天的 PR', botIds: ['b1'], timezone: 'Asia/Shanghai' }

  it('a schedule is either recurring (cron) or once (runAt)', () => {
    expect(CreateScheduleReq.safeParse({ ...base, cron: '0 9 * * 1-5' }).success).toBe(true)
    expect(CreateScheduleReq.safeParse({ ...base, runAt: '2026-10-05T09:00:00+08:00' }).success).toBe(true)
    expect(CreateScheduleReq.safeParse(base).success).toBe(false)
    expect(
      CreateScheduleReq.safeParse({ ...base, cron: '0 9 * * *', runAt: '2026-10-05T09:00:00Z' }).success,
    ).toBe(false)
    expect(CreateScheduleReq.safeParse({ ...base, cron: '0 9 * * *', botIds: [] }).success).toBe(false)
    expect(UpdateScheduleReq.safeParse({ enabled: false }).success).toBe(true)
    expect(UpdateScheduleReq.safeParse({ cron: '0 9 * * *', runAt: '2026-10-05T09:00:00Z' }).success).toBe(
      false,
    )
  })

  it('agent tools take bot names and name exactly one timing', () => {
    expect(ScheduleCreateArgs.safeParse({ name: 'a', prompt: 'b', cron: '*/30 * * * *' }).success).toBe(true)
    expect(ScheduleCreateArgs.safeParse({ name: 'a', prompt: 'b' }).success).toBe(false)
    expect(ScheduleCreateArgs.safeParse({ name: 'a', prompt: 'b', at: '2026-10-05 09:00' }).success).toBe(
      false,
    )
    expect(ScheduleUpdateArgs.safeParse({ id: 's', enabled: true }).success).toBe(true)
    expect(
      ScheduleUpdateArgs.safeParse({ id: 's', cron: '0 9 * * *', at: '2026-10-05T09:00:00Z' }).success,
    ).toBe(false)
  })

  it('describes common patterns in words and falls back to the expression', () => {
    expect(said({ cron: '0 9 * * *', runAt: null, timezone: 'UTC' })).toBe('每天 09:00')
    expect(said({ cron: '30 18 * * 1-5', runAt: null, timezone: 'UTC' })).toBe('每个工作日 18:30')
    expect(said({ cron: '0 10 * * 1', runAt: null, timezone: 'UTC' })).toBe('每周一 10:00')
    expect(said({ cron: '0 10 * * 0', runAt: null, timezone: 'UTC' })).toBe('每周日 10:00')
    expect(said({ cron: '5 8 1 * *', runAt: null, timezone: 'UTC' })).toBe('每月 1 日 08:05')
    expect(said({ cron: '*/30 * * * *', runAt: null, timezone: 'UTC' })).toBe('每 30 分钟')
    expect(said({ cron: '15 * * * *', runAt: null, timezone: 'UTC' })).toBe('每小时第 15 分')
    expect(said({ cron: '0 */2 * * *', runAt: null, timezone: 'UTC' })).toBe('每 2 小时')
    expect(said({ cron: '0 9 1,15 * *', runAt: null, timezone: 'UTC' })).toBe('cron 0 9 1,15 * *')
    expect(en(describeSchedule({ cron: '0 10 * * 1', runAt: null, timezone: 'UTC' }))).toBe(
      'Every Monday at 10:00',
    )
  })

  it('a one-off schedule shows its time in the schedule time zone', () => {
    const s = { cron: null, runAt: '2026-10-05T01:00:00.000Z', timezone: 'Asia/Shanghai' }
    expect(said(s)).toBe('仅一次 · 2026-10-05 09:00')
    expect(formatInZone('2026-10-05T01:00:00.000Z', 'UTC')).toBe('2026-10-05 01:00')
  })
})
