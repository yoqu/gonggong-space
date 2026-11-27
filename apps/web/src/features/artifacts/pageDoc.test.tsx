import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PageDocNode } from './pageDoc'
import { type PageRulesProps, PageRulesSection } from './pageRules'

const doc = (onSave: (md: string) => Promise<boolean>) => (
  <PageDocNode
    screenId="home"
    title="首页"
    md="旧文档"
    start={false}
    canEdit
    notes={[]}
    version="v1"
    ai={null}
    onSave={onSave}
    onAi={() => {}}
    onStatus={() => {}}
    onDelete={() => {}}
    onSendNotes={() => {}}
    onFocusNote={() => {}}
    zoom={1}
    onResize={() => {}}
    onMove={() => {}}
  />
)

it('keeps the typed page document when saving it fails', async () => {
  const onSave = vi.fn(async () => false)
  render(doc(onSave))
  fireEvent.click(screen.getByRole('button', { name: '编辑文档' }))
  const box = screen.getByRole('textbox', { name: '页面文档' })
  fireEvent.change(box, { target: { value: '新写的一大段' } })
  fireEvent.blur(box)
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('新写的一大段'))
  expect(((await screen.findByRole('textbox', { name: '页面文档' })) as HTMLTextAreaElement).value).toBe(
    '新写的一大段',
  )
})

it('keeps the edited page rules when saving them fails', async () => {
  const saveMd = vi.fn(async () => false)
  const rules = {
    page: { md: '1. 旧规则', rules: [{ text: '旧规则', label: '整页', anchor: null, pending: false }] },
    selected: null,
    select: () => {},
    adding: null,
    add: () => {},
    create: async () => true,
    cancelAdd: () => {},
    saveMd,
    complete: () => {},
    ai: null,
    gone: () => false,
    openShared: () => {},
  } as unknown as PageRulesProps
  render(<PageRulesSection rules={rules} canEdit />)
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  const box = screen.getByRole('textbox', { name: '页面规则' })
  fireEvent.change(box, { target: { value: '1. 新规则' } })
  fireEvent.blur(box)
  await waitFor(() => expect(saveMd).toHaveBeenCalledWith('1. 新规则'))
  expect(((await screen.findByRole('textbox', { name: '页面规则' })) as HTMLTextAreaElement).value).toBe(
    '1. 新规则',
  )
})
