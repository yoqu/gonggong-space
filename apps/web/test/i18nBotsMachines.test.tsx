import type { MachineDto } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

// Set before the app modules load: the locale is fixed per page load.
localStorage.setItem('gg.locale', 'en')
const { PRESENCE, TRIGGER_SCOPE_LABEL } = await import('../src/features/bots/model')
const { ROLES } = await import('../src/features/bots/avatars')
const { checkSummary } = await import('../src/features/repos/repo-access')
const { RevokeMachineDialog } = await import('../src/features/machines/RevokeMachineDialog')

it('translates bot labels, roles and repo check summaries', () => {
  expect(PRESENCE.online.label).toBe('Online, idle')
  expect(TRIGGER_SCOPE_LABEL.self).toBe('Owner only')
  expect(ROLES['role-gong'].name).toBe('Gong')
  expect(ROLES['role-invert'].mix).toBe('Pessimistic × Thorough × Protective')
  const results = [
    { botId: 'b1', ok: true, reason: null, detail: null, usedUrl: null },
    { botId: 'b2', ok: false, reason: 'offline', detail: null, usedUrl: null },
  ]
  const draft = {
    url: 'git@x:a/b.git',
    branch: 'main',
    check: { defaultBranch: 'main', branches: [], results },
  }
  expect(checkSummary(draft as never)).toBe('1 Bot can access · 1 offline')
})

it('renders the revoke machine dialog in English', () => {
  render(<RevokeMachineDialog machine={{ id: 'm1', name: 'mbp' } as MachineDto} onClose={() => {}} />)
  expect(screen.getByText('Revoke machine mbp?')).toBeTruthy()
  expect(screen.getByText("The machine's daemon disconnects immediately")).toBeTruthy()
})
