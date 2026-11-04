import type { DirListingDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirPicker } from '../src/features/workspaces/DirPicker'
import { apiError, mockApi } from './mockApi'

const at = (path: string) => `GET /machines/m1/dirs?path=${encodeURIComponent(path)}`
const listing = (path: string, o: Partial<DirListingDto> = {}): DirListingDto => ({
  path,
  entries: [
    { name: 'beta', git: false, modified: Date.UTC(2026, 0, 2) },
    { name: 'Alpha', git: true, modified: Date.UTC(2026, 0, 3) },
    { name: 'gamma', git: false, modified: Date.UTC(2026, 0, 1) },
  ],
  git: null,
  unusable: null,
  roots: ['/'],
  places: [
    { kind: 'home', name: 'w', path: '/Users/w' },
    { kind: 'desktop', name: 'Desktop', path: '/Users/w/Desktop' },
    { kind: 'documents', name: 'Documents', path: '/Users/w/Documents' },
    { kind: 'downloads', name: 'Downloads', path: '/Users/w/Downloads' },
    { kind: 'volume', name: 'Backup', path: '/Volumes/Backup' },
  ],
  canCreate: true,
  ...o,
})

const rows = () =>
  screen.getAllByTestId('dirpick-item').map((r) => r.querySelector('.dirpick__name')?.textContent)
const open = (onPick = vi.fn()) => {
  render(<DirPicker machineId="m1" title="选择目录" onPick={onPick} onClose={() => {}} />)
  return onPick
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('dir picker', () => {
  it('jumps to a place from the sidebar and highlights where it is', async () => {
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      [at('/Users/w/Desktop')]: listing('/Users/w/Desktop', { entries: [] }),
      [at('/Volumes/Backup')]: listing('/Volumes/Backup', { entries: [] }),
    })
    open()
    const side = await screen.findByRole('navigation', { name: '位置' })
    for (const name of ['w', '桌面', '文稿', '下载', 'Backup']) within(side).getByRole('button', { name })
    expect(within(side).getByRole('button', { name: 'w' }).getAttribute('aria-current')).toBe('true')
    expect(screen.queryByRole('button', { name: '磁盘' })).toBeNull()

    fireEvent.click(within(side).getByRole('button', { name: '桌面' }))
    await screen.findByText('没有子目录')
    expect(within(side).getByRole('button', { name: '桌面' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(side).getByRole('button', { name: 'Backup' }))
    await waitFor(() => expect(calls.at(-1)?.path).toBe('/machines/m1/dirs?path=%2FVolumes%2FBackup'))
  })

  it('calls the Windows documents folder 文档', async () => {
    mockApi({
      'GET /machines/m1/dirs': listing('C:\\Users\\w', {
        roots: ['C:\\', 'D:\\'],
        places: [
          { kind: 'documents', name: 'Documents', path: 'C:\\Users\\w\\Documents' },
          { kind: 'volume', name: 'D:', path: 'D:\\' },
        ],
      }),
    })
    open()
    const side = await screen.findByRole('navigation', { name: '位置' })
    within(side).getByRole('button', { name: '文档' })
    within(side).getByRole('button', { name: 'D:' })
  })

  it('remembers the picked folders of this machine under 最近使用', async () => {
    mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      [at('/Users/w/beta')]: listing('/Users/w/beta', { entries: [] }),
    })
    localStorage.setItem('gg.dirpick.recent.m1', JSON.stringify(['/a/1', '/a/2', '/a/3', '/a/4', '/a/5']))
    const onPick = open()
    fireEvent.click(await screen.findByText('beta'))
    await screen.findByText('没有子目录')
    fireEvent.click(screen.getByText('选择此目录'))
    expect(onPick).toHaveBeenCalledWith('/Users/w/beta')
    expect(JSON.parse(localStorage.getItem('gg.dirpick.recent.m1') ?? '')).toEqual([
      '/Users/w/beta',
      '/a/1',
      '/a/2',
      '/a/3',
      '/a/4',
    ])
  })

  it('opens a recent folder from the sidebar', async () => {
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      [at('/Users/w/code/pay')]: listing('/Users/w/code/pay', { entries: [] }),
    })
    localStorage.setItem('gg.dirpick.recent.m1', JSON.stringify(['/Users/w/code/pay']))
    open()
    const recent = await screen.findByRole('navigation', { name: '最近使用' })
    fireEvent.click(within(recent).getByRole('button', { name: 'pay' }))
    await waitFor(() => expect(calls.at(-1)?.path).toBe('/machines/m1/dirs?path=%2FUsers%2Fw%2Fcode%2Fpay'))
  })

  it('filters the folder by name, cleared by Escape or moving to another folder', async () => {
    mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      [at('/Users/w/Alpha')]: listing('/Users/w/Alpha'),
    })
    const onClose = vi.fn()
    render(<DirPicker machineId="m1" title="选择目录" onPick={() => {}} onClose={onClose} />)
    await screen.findByText('beta')
    const search = screen.getByRole('searchbox', { name: '搜索文件夹' })
    fireEvent.change(search, { target: { value: 'AL' } })
    expect(rows()).toEqual(['Alpha'])
    fireEvent.change(search, { target: { value: 'zz' } })
    expect(screen.getByText('没有匹配的文件夹')).toBeTruthy()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(rows()).toHaveLength(3)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(search, { target: { value: 'al' } })
    fireEvent.click(screen.getByText('Alpha'))
    await waitFor(() => expect((search as HTMLInputElement).value).toBe(''))
  })

  it('sorts by name or modified time, either way, and remembers the choice', async () => {
    mockApi({ 'GET /machines/m1/dirs': listing('/Users/w') })
    open()
    await screen.findByText('beta')
    expect(rows()).toEqual(['Alpha', 'beta', 'gamma'])
    fireEvent.click(screen.getByRole('button', { name: /名称/ }))
    expect(rows()).toEqual(['gamma', 'beta', 'Alpha'])
    fireEvent.click(screen.getByRole('button', { name: /修改时间/ }))
    expect(rows()).toEqual(['Alpha', 'beta', 'gamma'])
    fireEvent.click(screen.getByRole('button', { name: /修改时间/ }))
    expect(rows()).toEqual(['gamma', 'beta', 'Alpha'])
    expect(JSON.parse(localStorage.getItem('gg.dirpick.sort') ?? '')).toEqual({ by: 'modified', desc: false })
  })

  it('makes a new folder inline and opens it', async () => {
    const calls = mockApi({
      'GET /machines/m1/dirs': listing('/Users/w'),
      'POST /machines/m1/dirs': (body: unknown) =>
        (body as { name: string }).name === 'beta'
          ? apiError(400, 'invalid', '已存在同名文件夹')
          : { path: '/Users/w/新项目' },
      [at('/Users/w/新项目')]: listing('/Users/w/新项目', { entries: [] }),
    })
    open()
    await screen.findByText('beta')
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    const name = screen.getByRole('textbox', { name: '文件夹名称' }) as HTMLInputElement
    expect(name.value).toBe('未命名文件夹')
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, '未命名文件夹'.length])

    fireEvent.keyDown(name, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '文件夹名称' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    const again = screen.getByRole('textbox', { name: '文件夹名称' })
    fireEvent.change(again, { target: { value: 'beta' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(await screen.findByText('已存在同名文件夹')).toBeTruthy()

    fireEvent.change(again, { target: { value: '新项目' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    await screen.findByText('没有子目录')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ parent: '/Users/w', name: 'beta' })
    expect(calls.at(-1)?.path).toBe(`/machines/m1/dirs?path=${encodeURIComponent('/Users/w/新项目')}`)
  })

  it('offers no new folder when the daemon cannot make one', async () => {
    mockApi({ 'GET /machines/m1/dirs': listing('/Users/w', { canCreate: false }) })
    open()
    await screen.findByText('beta')
    expect(screen.queryByRole('button', { name: '新建文件夹' })).toBeNull()
  })
})
