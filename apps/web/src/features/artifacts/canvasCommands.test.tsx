import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { canvasCommandEntries } from './canvasCommands'
import { CanvasTips } from './canvasControls'
import { CMD, SHORTCUTS } from './menus'

const entries = () =>
  canvasCommandEntries({
    picked: [],
    pickedRefs: [],
    one: undefined,
    preview: null,
    screens: [],
    refs: [],
    links: [],
    canEdit: true,
    clip: null,
    hasThumb: false,
    botState: null,
    pluginCommands: [],
    sharedFrame: null,
    device: 'mobile',
    selected: [],
    noEditReason: undefined,
    designMd: null,
  })

it('lists the top bar’s tools in ⌘K and the shortcut sheet, not the removed 直接编辑', () => {
  const tools = entries().filter((e) => e.group === '工具')
  expect(tools.map((e) => e.label)).not.toContain('直接编辑')
  expect(tools.map((e) => e.label)).toEqual(expect.arrayContaining(['选择', '标记', '交互']))
  const sheet = SHORTCUTS.flatMap((g) => g.items.map((it) => it.label))
  expect(sheet).not.toContain('直接编辑')
})

it('opens the page’s document from ⌘K 批注 (the 批注 panel is gone)', () => {
  const notes = entries().find((e) => e.label === '批注')
  expect(notes?.value).toBe(CMD.notes)
})

it('says 选择 / 标记, not the removed 编辑 tool, while the pages take clicks', () => {
  const { container } = render(<CanvasTips through="play" />)
  expect(container.textContent).toContain('切回选择或标记可选元素')
})
