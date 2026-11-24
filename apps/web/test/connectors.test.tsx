import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { box, connector, manifest, openMenu, renderChat, routes } from './connectorFixtures'
import { mockApi } from './mockApi'

const dw = connector()
const modao = connector({
  id: 'c2',
  manifest: manifest({
    name: 'modao',
    title: '墨刀',
    description: '读取墨刀原型',
    secrets: ['MODAO_TOKEN'],
    secretSpecs: [{ name: 'MODAO_TOKEN', description: '', mode: 'shared', required: true }],
    connector: { examples: ['看看这个原型'] },
  }),
  personal: false,
  missing: [],
})
const meegle = connector({
  id: 'c3',
  manifest: manifest({
    name: 'meegle',
    title: '飞书项目',
    description: '查需求、缺陷和排期',
    connector: { examples: ['我这周有哪些待办', '列出本迭代的缺陷'] },
  }),
  connected: true,
  missing: [],
  sharedWith: ['dw-query'],
  status: 'ok',
})
const lark = connector({
  id: 'c5',
  manifest: manifest({
    name: 'feishu',
    title: '飞书',
    description: '文档、表格、日历',
    secrets: [],
    secretSpecs: [],
    connector: { examples: ['看看我今天的日程'], login: '帮我连接飞书' },
  }),
  personal: false,
  connected: true,
  missing: [],
  status: 'unchecked',
})
const off = connector({
  id: 'c4',
  manifest: manifest({ name: 'jenkins', title: '研发流水线' }),
  enabledInGroup: false,
})

describe('输入框 · 连接器菜单', () => {
  it("lists the group's enabled connectors with their status, searches and links to the market", async () => {
    mockApi(routes([dw, modao, meegle, off]))
    renderChat()
    const menu = await openMenu()
    const rows = await within(menu).findAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['数仓未连接连接', '墨刀待管理员配置', '飞书项目已连接'])
    expect(within(rows[0]!).getByRole('button', { name: '连接' })).toBeTruthy()

    fireEvent.change(within(menu).getByRole('searchbox', { name: '搜索连接器' }), { target: { value: '墨' } })
    expect(
      within(menu)
        .getAllByRole('listitem')
        .map((r) => r.textContent),
    ).toEqual(['墨刀待管理员配置'])
    fireEvent.change(within(menu).getByRole('searchbox', { name: '搜索连接器' }), {
      target: { value: 'xyz' },
    })
    expect(within(menu).getByText('没有匹配的连接器')).toBeTruthy()

    fireEvent.click(within(menu).getByRole('button', { name: '管理连接器' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/market?shelf=connector'))
  })

  it('shows each connection’s status; my switch turns one off for this group, an expired one asks to reconnect', async () => {
    const expired = connector({ connected: true, missing: [], status: 'expired' })
    const calls = mockApi({
      ...routes([expired, { ...meegle, account: '王磊' }]),
      'PUT /groups/g1/connectors/c3/switch': { ...meegle, on: false },
    })
    renderChat()
    const menu = await openMenu()
    const rows = await within(menu).findAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['数仓密钥已失效重新连接', '飞书项目已连接 · 王磊'])
    fireEvent.click(within(menu).getByRole('switch', { name: '在本群启用「飞书项目」' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        path: '/groups/g1/connectors/c3/switch',
        body: { on: false },
      }),
    )
    expect(await within(menu).findByText('本群已停用')).toBeTruthy()

    fireEvent.click(within(menu).getByRole('button', { name: '重新连接' }))
    const dialog = await screen.findByRole('dialog', { name: '数仓' })
    expect(within(dialog).getByText('密钥已失效')).toBeTruthy()
    expect(within(dialog).getByLabelText('DW_MANAGER_API_KEY')).toBeTruthy()
  })

  it('shows an empty state that leads to the market when the group has none', async () => {
    mockApi(routes([off]))
    renderChat()
    const menu = await openMenu()
    expect(await within(menu).findByText('还没有可用的连接器')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: '去市场看看' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/market?shelf=connector'))
  })
})

describe('连接器详情弹窗', () => {
  it('connects with my own key, usable on others’ machines', async () => {
    const calls = mockApi({
      ...routes([dw, modao]),
      'POST /groups/g1/connectors/c1/connect': connector({ connected: true, missing: [], status: 'ok' }),
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '连接' }))
    const dialog = await screen.findByRole('dialog', { name: '数仓' })
    expect(within(dialog).getByText('查询线上数据，按你的 Key 控制可见的库表')).toBeTruthy()
    expect(within(dialog).getByText(/将允许群内 Bot 在他人机器上使用/)).toBeTruthy()
    expect(within(dialog).getByText(/Bot 的回复群内可见/)).toBeTruthy()
    expect(within(dialog).getByText('数仓 Key')).toBeTruthy()
    expect(
      within(dialog)
        .getByRole('link', { name: /^如何获取/ })
        .getAttribute('href'),
    ).toBe('https://dw.example.com/keys')
    const connect = within(dialog).getByRole('button', { name: '连接' }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('DW_MANAGER_API_KEY'), {
      target: { value: 'sk-12345678' },
    })
    expect(connect.disabled).toBe(false)
    fireEvent.click(connect)
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/groups/g1/connectors/c1/connect')?.body,
      ).toEqual({
        values: { DW_MANAGER_API_KEY: 'sk-12345678' },
      }),
    )
    expect(await within(dialog).findByRole('button', { name: '去试试' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '解绑' })).toBeTruthy()
  })

  it('trims a pasted key and drops a leading Bearer', async () => {
    const calls = mockApi({
      ...routes([dw]),
      'POST /groups/g1/connectors/c1/connect': connector({ connected: true, missing: [], status: 'ok' }),
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '连接' }))
    const dialog = await screen.findByRole('dialog', { name: '数仓' })
    fireEvent.change(within(dialog).getByLabelText('DW_MANAGER_API_KEY'), {
      target: { value: '  Bearer sk-12345678 \n' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/groups/g1/connectors/c1/connect')?.body).toEqual({
        values: { DW_MANAGER_API_KEY: 'sk-12345678' },
      }),
    )
  })

  it('a shared connector not connected yet waits for an admin', async () => {
    mockApi(routes([modao]))
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '墨刀' }))
    const dialog = await screen.findByRole('dialog', { name: '墨刀' })
    expect(within(dialog).getByText(/待管理员配置/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '连接' })).toBeNull()
    expect(within(dialog).queryByText(/Bot 的回复群内可见/)).toBeNull()
  })

  it('去试试 and the example cards fill the composer @-ing the bot, without sending', async () => {
    const calls = mockApi(routes([meegle]))
    renderChat()
    let menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书项目' }))
    let dialog = await screen.findByRole('dialog', { name: '飞书项目' })
    fireEvent.click(within(dialog).getByRole('button', { name: '去试试' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '飞书项目' })).toBeNull())
    expect(box().value).toBe('@设计助手 我这周有哪些待办')

    fireEvent.change(box(), { target: { value: '' } })
    menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书项目' }))
    dialog = await screen.findByRole('dialog', { name: '飞书项目' })
    const tries = within(dialog).getByRole('region', { name: '试试这样用' })
    fireEvent.click(within(tries).getByRole('button', { name: '列出本迭代的缺陷' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '飞书项目' })).toBeNull())
    expect(box().value).toBe('@设计助手 列出本迭代的缺陷')
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/messages'))).toBe(false)
  })

  it('a CLI-login connector connects by asking the bot in the chat', async () => {
    mockApi(routes([lark]))
    renderChat()
    const menu = await openMenu()
    expect(within(menu).queryByText('已连接')).toBeNull()
    fireEvent.click(within(menu).getByRole('button', { name: '连接' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书' })
    expect(within(dialog).queryByRole('button', { name: '解绑' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '在对话里连接' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '飞书' })).toBeNull())
    expect(box().value).toBe('@设计助手 帮我连接飞书')
  })

  it('解绑 confirms, naming what else gets cut off', async () => {
    const calls = mockApi({
      ...routes([meegle]),
      'DELETE /groups/g1/connectors/c3/connection': undefined,
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书项目' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书项目' })
    fireEvent.click(within(dialog).getByRole('button', { name: '解绑' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('这些也会一起断开：dw-query')).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: '解绑' }))
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.path === '/groups/g1/connectors/c3/connection'),
      ).toBe(true),
    )
  })
})
