import { expect, it } from 'vitest'
import { newSessionNote } from '../src/features/chat/TimelineItems'

it('hides the note for a first session and translates known reasons', () => {
  expect(newSessionNote(null)).toBeNull()
  expect(newSessionNote('first')).toBeNull()
  expect(newSessionNote('resume_failed')).toContain('会话恢复失败')
})
