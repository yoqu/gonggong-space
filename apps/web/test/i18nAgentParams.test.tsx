import { type AgentCatalog, RECALLED_QUOTE, type SystemParams } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { mockApi } from './mockApi'

// Set before the app modules load: the locale is fixed per page load.
localStorage.setItem('gg.locale', 'en')
const { agentLabel, effortOptions } = await import('../src/features/bots/AgentConfig')
const { ParamsPage } = await import('../src/features/admin/ParamsPage')
const { MessageQuote } = await import('../src/features/attachments/MessageAttachments')

const catalog = {
  current: 'opus',
  models: [
    { value: 'opus', name: 'Opus', effort: 'medium', efforts: [{ value: 'low' }, { value: 'xhigh' }] },
  ],
} as unknown as AgentCatalog

it('shows model and effort labels in English', () => {
  expect(agentLabel(null, null, 'medium')).toBe('Default model · Medium')
  expect(agentLabel(catalog, 'opus', 'xhigh')).toBe('Opus · Extra high')
  expect(effortOptions(catalog, 'opus').map((o) => o.label)).toEqual([
    'Default (Medium)',
    'Low',
    'Extra high',
  ])
})

it('shows system parameter labels and units in English', async () => {
  const params = {
    sessionReplayTokens: 16000,
    contextInlineTokens: 8000,
    sessionIdleHours: 6,
    runRetentionDays: 30,
    previewIdleHours: 24,
    previewShareMaxDays: 30,
    attachmentMaxMb: 50,
    attachmentsPerMessage: 10,
    questionsPerCard: 4,
    heartbeatSec: 15,
    offlineMisses: 3,
    backupRetentionDays: 7,
    archiveRetentionDays: 30,
    approvalTimeoutMin: 30,
    chainMaxHops: 3,
    offlineWaitMin: 30,
    botConcurrencyDefault: 2,
    registrationOpen: false,
    singleTeamMode: true,
    teamCreation: 'sysadmin',
    feishuAutoSignup: true,
    publicUrl: '',
    demoMode: false,
    pluginsEnabled: false,
    pluginCodeEnabled: false,
  } satisfies SystemParams
  mockApi({ 'GET /admin/params': params })
  render(
    <MemoryRouter>
      <ParamsPage />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Machine heartbeat interval')).toBeTruthy()
  expect(screen.getByRole('spinbutton', { name: 'Machine heartbeat interval' })).toBeTruthy()
  expect(screen.getAllByText('sec').length).toBeGreaterThan(0)
  expect(screen.queryByText('机器心跳间隔')).toBeNull()
  expect(screen.queryByText('秒')).toBeNull()
})

it('shows a quote of a recalled message in English', () => {
  render(
    <MemoryRouter>
      <MessageQuote quote={{ kind: 'message', id: 'm1', who: 'Ann', text: RECALLED_QUOTE }} />
    </MemoryRouter>,
  )
  expect(screen.getByText('This message was recalled')).toBeTruthy()
})
