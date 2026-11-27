import { readFileSync } from 'node:fs'
import type { AnnotationDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { PageDocNode } from '../src/features/artifacts/pageDoc'
import { type PageRulesProps, PageRulesSection } from '../src/features/artifacts/pageRules'

const css = (p: string) => readFileSync(`src/features/artifacts/${p}`, 'utf8')
const ruleOf = (text: string, selector: string) => {
  const start = text.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  return text.slice(start, text.indexOf('}', start))
}

const note = (o: Partial<AnnotationDto> = {}): AnnotationDto => ({
  id: 'n1',
  artifactId: 'a1',
  versionId: 'v2',
  file: 'screens/home.html',
  ggId: '120',
  selector: 'body > h1',
  rect: { x: 10, y: 20, w: 100, h: 30 },
  snippet: '<h1>',
  note: '标题再大一点',
  authorId: 'u1',
  authorName: '王磊',
  status: 'open',
  createdAt: '2026-11-27T10:00:00Z',
  ...o,
})

function renderDoc(o: Partial<Parameters<typeof PageDocNode>[0]> = {}) {
  const props = {
    screenId: 'home',
    title: '首页',
    md: '# 首页',
    start: false,
    canEdit: true,
    notes: [],
    version: 'v2',
    ai: null,
    onSave: vi.fn(async () => true),
    onAi: vi.fn(),
    onStatus: vi.fn(),
    onDelete: vi.fn(),
    onSendNotes: vi.fn(),
    onFocusNote: vi.fn(),
    zoom: 1,
    onResize: vi.fn(),
    onMove: vi.fn(),
    ...o,
  }
  render(<PageDocNode {...props} />)
  return props
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('页面文档 motion', () => {
  it('follows a header drag and an edge drag on every pointer move, with nothing easing its box', () => {
    const p = renderDoc({ zoom: 2 })
    fireEvent.pointerDown(screen.getByTestId('art-pagedoc-move-home'), {
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 120 })
    expect(p.onMove).toHaveBeenLastCalledWith({ dx: 20, dy: 10 }, false)
    fireEvent.pointerMove(window, { clientX: 160, clientY: 140 })
    expect(p.onMove).toHaveBeenLastCalledWith({ dx: 30, dy: 20 }, false)
    fireEvent.pointerUp(window, { clientX: 160, clientY: 140 })
    expect(p.onMove).toHaveBeenLastCalledWith({ dx: 30, dy: 20 }, true)

    fireEvent.pointerDown(screen.getByTestId('art-pagedoc-grip-se'), { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 1000, clientY: 1000 })
    expect(p.onResize).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(window, { clientX: 1000, clientY: 1000 })
    expect(p.onResize).toHaveBeenLastCalledWith({ w: 500, h: 500 }, true)

    // The node's box (left/top/width/height) is set directly: no transition may ease it, nor bounce it on release.
    const doc = screen.getByTestId('art-pagedoc-home')
    expect(doc.style.transition).toBe('')
    for (const f of ['canvas-motion.css', 'inspector.css', 'artifacts.css'])
      for (const m of css(f).matchAll(/transition:([^;]+);/g))
        expect(m[1], f).not.toMatch(/\b(left|top|width|height|all)\b/)
  })

  it('arrives from its center, and its grips stay findable at rest', () => {
    const motion = css('canvas-motion.css')
    const enter = ruleOf(motion, '.art-node--pagedoc')
    expect(enter).toContain('--enter-scale: 0.98')
    expect(enter).toContain('--enter-y: -4px')
    expect(enter).toContain('var(--spring-snappy) ui-enter')
    expect(enter).not.toContain('transform-origin')
    const grip = ruleOf(motion, '.art-pagedoc__grip')
    expect(grip).toContain('opacity: 0.3')
    expect(grip).toContain('transition: opacity var(--fade-fast)')
    expect(css('Inspector.tsx')).toContain("import './canvas-motion.css'")
  })

  it('swaps read and edit in place: the editor mounts focused and labelled, 完成 brings the text back', async () => {
    const p = renderDoc()
    const doc = screen.getByTestId('art-pagedoc-home')
    expect(doc.querySelector('.md')).toBeTruthy()
    fireEvent.click(within(doc).getByRole('button', { name: '编辑文档' }))
    const box = within(doc).getByRole('textbox', { name: '页面文档' })
    expect(document.activeElement).toBe(box)
    expect(box.classList.contains('art-pagedoc__input')).toBe(true)
    expect(within(doc).queryByRole('button', { name: 'AI 帮我写' })).toBeNull()
    fireEvent.change(box, { target: { value: '# 新' } })
    await act(async () => fireEvent.click(within(doc).getByRole('button', { name: '完成' })))
    expect(p.onSave).toHaveBeenCalledWith('# 新')
    expect(within(doc).queryByRole('textbox')).toBeNull()
    expect(within(doc).getByRole('button', { name: 'AI 帮我写' })).toBeTruthy()
  })

  it('lets a deleted note slide out before it goes', () => {
    vi.useFakeTimers()
    useSession.setState({ user: { id: 'u1' } as never })
    const p = renderDoc({ notes: [note()] })
    const row = screen.getAllByRole('listitem')[0] as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '删除' }))
    fireEvent.click(within(row).getByRole('button', { name: '确认删除' }))
    expect(row.classList.contains('ui-leaving')).toBe(true)
    expect(p.onDelete).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(300))
    expect(p.onDelete).toHaveBeenCalledWith('n1')
  })
})

describe('页面规则 locating', () => {
  const rules = (o: Partial<PageRulesProps> = {}): PageRulesProps => ({
    page: {
      md: '',
      rules: [
        { label: '标题', anchor: 'h1', text: '加粗', pending: false },
        { label: '按钮', anchor: 'btn', text: '圆角', pending: false },
      ],
    } as never,
    selected: null,
    select: vi.fn(),
    adding: null,
    add: vi.fn(),
    create: vi.fn(async () => true),
    cancelAdd: vi.fn(),
    saveMd: vi.fn(async () => true),
    complete: vi.fn(),
    ai: null,
    gone: () => false,
    openShared: vi.fn(),
    ...o,
  })
  const scrolls = () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    return spy
  }
  const reduce = (on: boolean) =>
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: on && q === '(prefers-reduced-motion: reduce)',
      addEventListener() {},
      removeEventListener() {},
    }))

  it('glides to the entry a page number points to and rings it once', () => {
    reduce(false)
    const spy = scrolls()
    const { rerender } = render(<PageRulesSection rules={rules()} canEdit />)
    rerender(<PageRulesSection rules={rules({ selected: 1 })} canEdit />)
    expect(spy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    expect(screen.getByTestId('art-pagedoc-rule-2').classList.contains('art-pagedoc__rule--on')).toBe(true)
    expect(ruleOf(css('canvas-motion.css'), '.art-pagedoc__rule--on::after')).toContain(
      'art-landed-flash var(--flash)',
    )
  })

  it('jumps without gliding under reduced motion', () => {
    reduce(true)
    const spy = scrolls()
    const { rerender } = render(<PageRulesSection rules={rules()} canEdit />)
    rerender(<PageRulesSection rules={rules({ selected: 0 })} canEdit />)
    expect(spy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
    // Press scales only with motion allowed; springs collapse to 0s under reduced motion (base.css).
    const motion = css('canvas-motion.css')
    const press = motion.slice(motion.indexOf('@media (prefers-reduced-motion: no-preference)'))
    expect(press).toContain('scale: var(--press-button)')
    expect(motion.slice(0, motion.indexOf('@media'))).not.toMatch(/scale: var\(--press/)
  })
})

describe('in-place editing panel motion', () => {
  it('fades 外观 ↔ 交互 in the same panel and shifts a newly picked tab in', () => {
    const motion = css('canvas-motion.css')
    expect(ruleOf(motion, 'fieldset.art-el')).toContain('var(--fade-in) ui-fade-in')
    expect(ruleOf(motion, 'fieldset.art-el[data-view="interact"]')).toContain('animation-name: art-el-swap')
    expect(css('ElementPanel.tsx')).toContain('data-view={view}')
    expect(motion).toContain(':where(.art-inspector__body > :not(.art-panel:has(fieldset.art-el)))')
    for (const sel of ['.art-inspector__tab', '.art-layers__row', '.mk-num'])
      expect(motion).toMatch(
        new RegExp(`${sel.replace(/[.]/g, '\\.')}[,\\s][^{]*\\{[^}]*var\\(--fade-fast\\)`),
      )
  })
})
