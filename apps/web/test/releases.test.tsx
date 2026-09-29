import type { AdminMachineDto, DaemonRelease, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { mockApi } from './mockApi'

const admin: UserDto = {
  id: 'u0',
  account: 'chenchen',
  name: '陈晨',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
}
const sha = (c: string) => c.repeat(64)
const release: DaemonRelease = {
  version: '0.2.0',
  builds: { 'macos-aarch64': { url: '/downloads/gonggong-0.2.0-macos-aarch64', sha256: sha('a') } },
  cast: {},
}
const machine = (o: Partial<AdminMachineDto>) =>
  ({ id: 'm1', os: 'macos', arch: 'aarch64', ...o }) as AdminMachineDto

/** Records multipart posts and answers each with `reply(file name)`. */
function fakeXhr(reply: (name: string) => { status: number; body: unknown }) {
  const sent: string[] = []
  class FakeXhr {
    status = 0
    response: unknown = null
    upload = { onprogress: null }
    withCredentials = false
    responseType = ''
    onload: (() => void) | null = null
    onerror = null
    onabort = null
    url = ''
    open(_m: string, url: string) {
      this.url = url
    }
    send(form: FormData) {
      const name = (form.get('file') as File).name
      sent.push(`${this.url} ${name}`)
      const r = reply(name)
      this.status = r.status
      this.response = r.body
      queueMicrotask(() => this.onload?.())
    }
    abort() {}
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  return sent
}

class NoopSocket {
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: admin, status: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/releases']}>
      <App />
    </MemoryRouter>,
  )
const rowOf = (text: string) =>
  screen.getByRole('gridcell', { name: text }).closest('[role="row"]') as HTMLElement
const cells = (text: string) =>
  within(rowOf(text))
    .getAllByRole('gridcell')
    .map((c) => c.textContent)
    .slice(0, 5)

describe('管理后台 · 客户端发布', () => {
  it('shows every platform with its daemon and gg-cast builds and the machines that need them', async () => {
    mockApi({
      'GET /admin/daemon-release': release,
      'GET /admin/machines': [
        machine({}),
        machine({ id: 'm2' }),
        machine({ id: 'm3', os: 'windows', arch: 'x86_64' }),
      ],
    })
    renderPage()
    await screen.findByRole('gridcell', { name: 'macos-aarch64' })
    expect(screen.getByText('当前版本 0.2.0')).toBeTruthy()
    expect(cells('macos-aarch64')).toEqual([
      'macOS aarch64',
      'macos-aarch64',
      `已发布 ${'a'.repeat(12)}`,
      '未发布',
      '2',
    ])
    expect(cells('windows-x86_64')).toEqual(['Windows x86_64', 'windows-x86_64', '未发布', '未发布', '1'])
    expect(cells('linux-aarch64')[4]).toBe('0')
  })

  it('uploads dropped release artifacts one by one and rejects other files without sending them', async () => {
    const next: DaemonRelease = {
      ...release,
      cast: { 'macos-aarch64': { url: '/downloads/gg-cast-0.2.0-macos-aarch64', sha256: sha('b') } },
    }
    mockApi({ 'GET /admin/daemon-release': null, 'GET /admin/machines': [] })
    const sent = fakeXhr((name) =>
      name.startsWith('gg-cast') ? { status: 200, body: next } : { status: 200, body: release },
    )
    const { container } = renderPage()
    expect(await screen.findByText('尚未发布')).toBeTruthy()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = (name: string) => new File(['x'], name)
    fireEvent.change(input, {
      target: {
        files: [
          file('gonggong-0.2.0-macos-aarch64'),
          file('SHA256SUMS'),
          file('gg-cast-0.2.0-macos-aarch64'),
        ],
      },
    })
    await waitFor(() => expect(cells('macos-aarch64')[3]).toBe(`已发布 ${'b'.repeat(12)}`))
    expect(sent).toEqual([
      '/api/admin/daemon-release/files gonggong-0.2.0-macos-aarch64',
      '/api/admin/daemon-release/files gg-cast-0.2.0-macos-aarch64',
    ])
    expect(screen.getByText('当前版本 0.2.0')).toBeTruthy()
    expect(screen.getByText(/不是发布产物/)).toBeTruthy()
  })

  it('removes one platform build after confirming', async () => {
    const calls = mockApi({
      'GET /admin/daemon-release': release,
      'GET /admin/machines': [],
      'DELETE /admin/daemon-release/builds/macos-aarch64': { ...release, builds: {} },
    })
    renderPage()
    await screen.findByRole('gridcell', { name: 'macos-aarch64' })
    fireEvent.click(within(rowOf('macos-aarch64')).getByRole('button', { name: '操作' }))
    expect(screen.queryByRole('menuitem', { name: '移除 gg-cast…' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '移除 daemon…' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '移除' }))
    await waitFor(() => expect(cells('macos-aarch64')[2]).toBe('未发布'))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })
})
