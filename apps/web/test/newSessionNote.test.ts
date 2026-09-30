import { expect, it } from 'vitest'
import { newSessionNote } from '../src/features/chat/TimelineItems'

it('hides the note for a first session and translates known reasons', () => {
  expect(newSessionNote(null)).toBeNull()
  expect(newSessionNote('first')).toBeNull()
  expect(newSessionNote('resume_failed')).toContain('会话恢复失败')
  expect(newSessionNote('config_changed')).toBe('本轮因配置变更开启新会话')
})

it('explains a new session opened because the pinned provider was deleted', () => {
  expect(newSessionNote('provider_removed')).toBe('原供应商已删除，已开启新会话')
})
