import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type Providers } from '../src/ipc'
import { AgentsPage } from '../src/pages/Agents'
import { useDaemon } from '../src/store'
import { CLAUDE, CODEX, INFO, KIMI, OPENROUTER, provider } from './ipc-mock'

const m = vi.mocked(ipc)

const DATA: Providers = {
  machine: {},
  bots: {},
  providers: [
    provider({ id: 'kimi-1', name: 'Kimi' }),
    provider({ id: 'ds-1', agent: 'codex', name: 'DeepSeek' }),
  ],
  ccSwitch: true,
  proxies: { 'kimi-1': 'http://127.0.0.1:7890' },
}

beforeEach(() => {
  vi.clearAllMocks()
  useDaemon.setState({ info: INFO })
  m.agents.mockResolvedValue([CLAUDE, CODEX])
  m.bots.mockResolvedValue([])
  m.providers.mockResolvedValue(DATA)
  m.providerPresets.mockResolvedValue([
    KIMI,
    OPENROUTER,
    { ...KIMI, id: 'deepseek', agent: 'codex', name: 'DeepSeek' },
  ])
  m.chooseProvider.mockResolvedValue()
  m.saveProvider.mockResolvedValue('kimi-coding-9f3e')
  m.removeProvider.mockResolvedValue()
  m.openKeyPage.mockResolvedValue()
})

/** The 本机供应商 box right after an agent's card. */
const box = async (agent: 'Claude Code' | 'Codex') => {
  const title = await screen.findByText(agent)
  const card = title.closest('.dk-agent') as HTMLElement
  const head = await within(card).findByText('本机供应商')
  return within(head.closest('.ui-group') as HTMLElement)
}

it('lists this agent’s providers with masked keys and switches the default after confirming', async () => {
  render(<AgentsPage go={() => {}} />)
  const claude = await box('Claude Code')
  expect((claude.getByRole('radio', { name: /官方登录/ }) as HTMLInputElement).checked).toBe(true)
  expect(claude.getByText('https://api.kimi.com/coding/ · kimi-for-coding · Key ****abcd')).toBeTruthy()
  expect(claude.queryByText('DeepSeek')).toBeNull()
  expect((await box('Codex')).getByText('DeepSeek')).toBeTruthy()

  m.providerImpact.mockResolvedValue([
    { group: '支付服务重构', bot: '小王的 Claude', from: '官方登录', to: 'Kimi' },
    { group: '官网改版', bot: '小王的 Claude', from: '官方登录', to: 'Kimi' },
  ])
  fireEvent.click(claude.getByRole('radio', { name: /Kimi/ }))
  await waitFor(() => expect(m.providerImpact).toHaveBeenCalledWith('claude', 'kimi-1', undefined))
  const alert = within(await screen.findByRole('alertdialog'))
  expect(alert.getByText('2 个群的会话仍在使用 官方登录，开启新会话后才会切换到 Kimi：')).toBeTruthy()
  fireEvent.click(alert.getByRole('button', { name: '取消' }))
  expect(m.chooseProvider).not.toHaveBeenCalled()

  m.providerImpact.mockResolvedValue([])
  fireEvent.click(claude.getByRole('radio', { name: /Kimi/ }))
  await waitFor(() => expect(m.chooseProvider).toHaveBeenCalledWith('claude', 'kimi-1', undefined))
  expect(m.providers).toHaveBeenCalledTimes(2)
})

it('adds a provider from a preset: pick the vendor, fill only the key, then make it the default', async () => {
  render(<AgentsPage go={() => {}} />)
  fireEvent.click((await box('Claude Code')).getByRole('button', { name: '新增…' }))
  const picker = within(await screen.findByRole('dialog', { name: '新增 Claude Code 供应商' }))
  expect(await picker.findByText('国内厂商')).toBeTruthy()
  expect(picker.getByText('聚合平台')).toBeTruthy()
  expect(picker.queryByText('DeepSeek')).toBeNull()
  fireEvent.change(picker.getByRole('searchbox', { name: '搜索厂商' }), { target: { value: 'open' } })
  expect(picker.queryByText('Kimi For Coding')).toBeNull()
  fireEvent.change(picker.getByRole('searchbox', { name: '搜索厂商' }), { target: { value: '' } })
  fireEvent.click(picker.getByText('Kimi For Coding'))

  const form = within(await screen.findByRole('dialog', { name: '新增 Claude Code 供应商' }))
  expect((form.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('Kimi For Coding')
  expect((form.getByRole('combobox', { name: '模型' }) as HTMLInputElement).value).toBe('kimi-for-coding')
  expect(form.queryByRole('textbox', { name: 'Base URL' })).toBeNull()
  fireEvent.click(form.getByRole('button', { name: '获取 Key' }))
  expect(m.openKeyPage).toHaveBeenCalledWith('claude', 'kimi-coding')

  fireEvent.click(form.getByRole('button', { name: '保存' }))
  expect(await form.findByText('请填写 API Key')).toBeTruthy()
  expect(m.saveProvider).not.toHaveBeenCalled()

  fireEvent.change(form.getByLabelText('API Key'), { target: { value: 'sk-new-key-12345678' } })
  fireEvent.click(form.getByRole('checkbox', { name: '设为本机默认' }))
  fireEvent.click(form.getByRole('button', { name: /高级/ }))
  expect((form.getByRole('textbox', { name: 'Base URL' }) as HTMLInputElement).value).toBe(
    'https://api.kimi.com/coding/',
  )
  expect((form.getByRole('textbox', { name: '环境变量' }) as HTMLTextAreaElement).value).toBe(
    'CLAUDE_CODE_MAX_CONTEXT_TOKENS=262144',
  )
  fireEvent.change(form.getByRole('textbox', { name: 'opus 模型' }), { target: { value: 'kimi-k2' } })
  fireEvent.click(form.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(m.saveProvider).toHaveBeenCalledWith({
      id: null,
      agent: 'claude',
      presetId: 'kimi-coding',
      name: 'Kimi For Coding',
      baseUrl: 'https://api.kimi.com/coding/',
      apiKey: 'sk-new-key-12345678',
      model: 'kimi-for-coding',
      models: { haiku: 'kimi-for-coding', sonnet: 'kimi-for-coding', opus: 'kimi-k2' },
      env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144' },
      proxy: null,
    }),
  )
  await waitFor(() => expect(m.chooseProvider).toHaveBeenCalledWith('claude', 'kimi-coding-9f3e', undefined))
})

it('adds a custom provider with its own Base URL, proxy and environment', async () => {
  render(<AgentsPage go={() => {}} />)
  fireEvent.click((await box('Codex')).getByRole('button', { name: '新增…' }))
  fireEvent.click(await screen.findByText('自定义'))
  const form = within(await screen.findByRole('dialog', { name: '新增 Codex 供应商' }))
  fireEvent.change(form.getByRole('textbox', { name: '名称' }), { target: { value: '公司中转' } })
  fireEvent.change(form.getByRole('textbox', { name: 'Base URL' }), {
    target: { value: 'https://relay.corp.cn/v1' },
  })
  fireEvent.change(form.getByLabelText('API Key'), { target: { value: 'sk-relay-12345678' } })
  fireEvent.change(form.getByRole('combobox', { name: '模型' }), { target: { value: 'gpt-6' } })
  fireEvent.click(form.getByRole('button', { name: /高级/ }))
  fireEvent.change(form.getByRole('textbox', { name: '代理地址' }), {
    target: { value: ' http://127.0.0.1:7890 ' },
  })
  fireEvent.change(form.getByRole('textbox', { name: '环境变量' }), {
    target: { value: 'NO_PROXY=.corp.cn' },
  })
  fireEvent.click(form.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(m.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'codex',
        presetId: null,
        baseUrl: 'https://relay.corp.cn/v1',
        model: 'gpt-6',
        proxy: 'http://127.0.0.1:7890',
        env: { NO_PROXY: '.corp.cn' },
      }),
    ),
  )
  expect(m.chooseProvider).not.toHaveBeenCalled()
})

it('edits without ever showing the stored key, and removes after confirming', async () => {
  render(<AgentsPage go={() => {}} />)
  const claude = await box('Claude Code')
  fireEvent.click(claude.getByRole('button', { name: '编辑…' }))
  const form = within(await screen.findByRole('dialog', { name: '编辑供应商' }))
  const key = form.getByLabelText('API Key') as HTMLInputElement
  expect(key.placeholder).toBe('****abcd')
  expect(key.value).toBe('')
  expect(form.getByText('留空则保留已保存的 Key')).toBeTruthy()
  expect(await form.findByRole('button', { name: '恢复为预设值' })).toBeTruthy()
  fireEvent.change(form.getByRole('textbox', { name: '名称' }), { target: { value: 'Kimi 公司账号' } })
  fireEvent.click(form.getByRole('button', { name: /高级/ }))
  const proxy = form.getByRole('textbox', { name: '代理地址' }) as HTMLInputElement
  expect(proxy.value).toBe('http://127.0.0.1:7890')
  fireEvent.click(form.getByRole('button', { name: '恢复为预设值' }))
  expect(proxy.value).toBe('http://127.0.0.1:7890')
  fireEvent.change(form.getByRole('textbox', { name: '名称' }), { target: { value: 'Kimi 公司账号' } })
  fireEvent.change(proxy, { target: { value: '' } })
  fireEvent.click(form.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(m.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'kimi-1', name: 'Kimi 公司账号', apiKey: '', proxy: null }),
    ),
  )

  fireEvent.click(claude.getByRole('button', { name: '删除' }))
  const alert = within(await screen.findByRole('alertdialog', { name: '要删除供应商 Kimi 吗？' }))
  expect(alert.getByText('正在使用它的会话下一轮会自动开启新会话。')).toBeTruthy()
  fireEvent.click(alert.getByRole('button', { name: '删除' }))
  await waitFor(() => expect(m.removeProvider).toHaveBeenCalledWith('kimi-1'))
})

it('imports from CC Switch with a masked preview, then makes its current one the default', async () => {
  m.ccswitchPreview.mockResolvedValue([
    {
      key: 'claude:a',
      agent: 'claude',
      name: 'GLM',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: '****9z9z',
      model: 'glm-5',
      current: true,
      existing: null,
    },
    {
      key: 'claude:b',
      agent: 'claude',
      name: 'Kimi',
      baseUrl: 'https://api.kimi.com/coding/',
      apiKey: '****abcd',
      model: null,
      current: false,
      existing: 'kimi-1',
    },
    {
      key: 'codex:c',
      agent: 'codex',
      name: 'X',
      baseUrl: 'https://x',
      apiKey: '****',
      model: null,
      current: true,
      existing: null,
    },
  ])
  m.ccswitchImport.mockResolvedValue(['glm-1'])
  render(<AgentsPage go={() => {}} />)
  fireEvent.click((await box('Claude Code')).getByRole('button', { name: '从 CC Switch 导入…' }))
  const dialog = within(await screen.findByRole('dialog', { name: '从 CC Switch 导入 Claude Code 供应商' }))
  expect(
    await dialog.findByText('https://open.bigmodel.cn/api/anthropic · glm-5 · Key ****9z9z'),
  ).toBeTruthy()
  expect(dialog.getByText('CC Switch 当前')).toBeTruthy()
  expect(dialog.getByText('将更新已有项')).toBeTruthy()
  expect(dialog.queryByText('X')).toBeNull()
  fireEvent.click(dialog.getByRole('checkbox', { name: /Kimi/ }))
  fireEvent.click(dialog.getByRole('button', { name: '导入' }))
  await waitFor(() => expect(m.ccswitchImport).toHaveBeenCalledWith(['claude:a']))
  await waitFor(() => expect(m.chooseProvider).toHaveBeenCalledWith('claude', 'glm-1', undefined))
})

it('hides the CC Switch import where there is none, and imports a pasted link', async () => {
  m.providers.mockResolvedValue({ ...DATA, ccSwitch: false })
  m.importProviderLink.mockResolvedValue(provider({ id: 'relay-1', name: 'Relay', agent: 'codex' }))
  render(<AgentsPage go={() => {}} />)
  const claude = await box('Claude Code')
  expect(claude.queryByRole('button', { name: '从 CC Switch 导入…' })).toBeNull()
  fireEvent.click(claude.getByRole('button', { name: '粘贴链接导入…' }))
  const dialog = within(await screen.findByRole('dialog', { name: '粘贴链接导入' }))
  fireEvent.change(dialog.getByRole('textbox', { name: '导入链接' }), {
    target: { value: 'ccswitch://v1/import?resource=provider&app=codex&name=Relay' },
  })
  fireEvent.click(dialog.getByRole('checkbox', { name: '设为本机默认' }))
  fireEvent.click(dialog.getByRole('button', { name: '导入' }))
  await waitFor(() =>
    expect(m.importProviderLink).toHaveBeenCalledWith(
      'ccswitch://v1/import?resource=provider&app=codex&name=Relay',
    ),
  )
  await waitFor(() => expect(m.chooseProvider).toHaveBeenCalledWith('codex', 'relay-1', undefined))
})
