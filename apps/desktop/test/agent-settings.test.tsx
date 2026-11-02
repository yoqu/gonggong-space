import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type Providers } from '../src/ipc'
import { AgentsPage } from '../src/pages/Agents'
import { agentSettingRows, formatTokens, providerSummary } from '../src/providers/settings'
import { useDaemon } from '../src/store'
import { CLAUDE, CODEX, INFO, provider } from './ipc-mock'

const m = vi.mocked(ipc)

describe('formatTokens', () => {
  it('abbreviates decimal and binary sizes', () => {
    expect(formatTokens('200000')).toBe('200K')
    expect(formatTokens('262144')).toBe('256K')
    expect(formatTokens('128000')).toBe('128K')
    expect(formatTokens('1000000')).toBe('1M')
    expect(formatTokens('1048576')).toBe('1M')
    expect(formatTokens('12345')).toBe('12345')
  })
})

describe('providerSummary', () => {
  it('lists the provider-layer settings an env sets', () => {
    expect(
      providerSummary('claude', {
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000',
        CLAUDE_CODE_DISABLE_THINKING: '1',
        ENABLE_TOOL_SEARCH: 'false',
        API_TIMEOUT_MS: '600000',
        HTTP_PROXY: 'x',
      }),
    ).toBe('上下文 256K · 输出 128K · 关闭思考参数 · 工具搜索 关 · API 超时 10 分钟')
  })

  it('shows tool search auto values as stored', () => {
    expect(providerSummary('claude', { ENABLE_TOOL_SEARCH: 'auto:5' })).toBe('工具搜索 auto:5')
  })

  it('shows a flag of true as on', () => {
    expect(agentSettingRows('claude', { nonessentialTraffic: 'true' })[0]?.value).toBe('是')
  })

  it('is empty without known settings or for agents without fields', () => {
    expect(providerSummary('claude', { FOO: '1' })).toBe('')
    expect(providerSummary('codex', { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144' })).toBe('')
  })
})

const DATA: Providers = {
  machine: {},
  bots: {},
  official: { claude: { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '180000' }, proxy: null, args: [] } },
  providers: [
    provider({
      id: 'kimi-1',
      name: 'Kimi',
      env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000' },
    }),
  ],
  agentSettings: {
    claude: { values: { language: 'chinese', attribution: 'none', bashTimeout: '120000' }, inheritCli: true },
  },
  cli: {
    claude: {
      values: { language: 'english' },
      conflicts: ['CLAUDE_CODE_EFFORT_LEVEL', 'ANTHROPIC_MODEL'],
      hooks: 2,
      permissionRules: 5,
      version: '2.1.296',
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  useDaemon.setState({ info: INFO })
  m.agents.mockResolvedValue([CLAUDE, CODEX])
  m.bots.mockResolvedValue([])
  m.providers.mockResolvedValue(DATA)
  m.openProvidersInWeb.mockResolvedValue()
})

const group = async (agent: string, title: string) => {
  const card = (await screen.findByText(agent)).closest('.dk-agent') as HTMLElement
  const head = await within(card).findByText(title)
  return within(head.closest('.ui-group') as HTMLElement)
}

it('summarises each provider’s settings', async () => {
  render(<AgentsPage go={() => {}} />)
  const box = await group('Claude Code', '本机供应商')
  expect(box.getByText('上下文 256K · 输出 128K')).toBeTruthy()
  expect(box.getByText('自动压缩 180K')).toBeTruthy()
})

it('shows the machine’s agent settings read-only, with CLI conflicts and the way to the Web', async () => {
  render(<AgentsPage go={() => {}} />)
  const box = await group('Claude Code', 'Agent 设置')
  expect(box.getByText('语言')).toBeTruthy()
  expect(box.getByText('chinese')).toBeTruthy()
  expect(box.getByText('提交署名')).toBeTruthy()
  expect(box.getByText('不署名')).toBeTruthy()
  expect(box.getByText('2 分钟')).toBeTruthy()
  expect(box.queryByText('自动记忆')).toBeNull()
  expect(box.getByText('继承本机 CLI 配置')).toBeTruthy()
  expect(box.getByText('是')).toBeTruthy()
  expect(
    box.getByText('本机 CLI 配置设置了 CLAUDE_CODE_EFFORT_LEVEL、ANTHROPIC_MODEL，会盖过共工的对应设置'),
  ).toBeTruthy()
  expect(box.queryByRole('checkbox')).toBeNull()
  expect(box.queryByRole('textbox')).toBeNull()
  fireEvent.click(box.getByRole('button', { name: '在 Web 中管理' }))
  await waitFor(() => expect(m.openProvidersInWeb).toHaveBeenCalled())

  const codex = (await screen.findByText('Codex')).closest('.dk-agent') as HTMLElement
  expect(within(codex).queryByText('Agent 设置')).toBeNull()
})

it('falls back to Claude Code defaults and hides conflicts when the CLI config is not inherited', async () => {
  m.providers.mockResolvedValue({
    ...DATA,
    agentSettings: { claude: { values: {}, inheritCli: false } },
  })
  render(<AgentsPage go={() => {}} />)
  const box = await group('Claude Code', 'Agent 设置')
  expect(box.getByText('未设置，使用 Claude Code 默认值')).toBeTruthy()
  expect(box.getByText('否')).toBeTruthy()
  expect(box.queryByText(/会盖过共工/)).toBeNull()
})

it('inherits the CLI config when the daemon reports no agent settings', async () => {
  m.providers.mockResolvedValue({ machine: {}, bots: {}, providers: [] })
  render(<AgentsPage go={() => {}} />)
  const box = await group('Claude Code', 'Agent 设置')
  expect(box.getByText('是')).toBeTruthy()
})
