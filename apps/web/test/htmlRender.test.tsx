import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HTML_RENDER_PALETTES, type HtmlRenderRef } from '@gonggong/protocol'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HtmlRender } from '../src/features/rich/HtmlRender'

const page: HtmlRenderRef = { attachmentId: 'a1', title: 'CPU 走势', height: 300 }

const frameOf = () => screen.getByTitle('CPU 走势') as HTMLIFrameElement
const post = (source: MessageEventSource | null, data: unknown) =>
  act(() => window.dispatchEvent(new MessageEvent('message', { data, source })))
const size = (height: number) => ({
  jsonrpc: '2.0',
  method: 'ui/notifications/size-changed',
  params: { height },
})
const link = (url: string) => ({ jsonrpc: '2.0', id: 'gg-link-1', method: 'ui/open-link', params: { url } })

beforeEach(() => {
  document.documentElement.dataset.theme = 'light'
  document.documentElement.style.setProperty('--content-bg', '#fefefe')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('html render', () => {
  it('loads the page sandboxed without same-origin, themed through the URL fragment', () => {
    render(<HtmlRender page={page} />)
    const frame = frameOf()
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    const [path, fragment] = (frame.getAttribute('src') ?? '').split('#gg-theme=')
    expect(path).toBe('/api/attachments/a1/render')
    const theme = JSON.parse(decodeURIComponent(fragment ?? ''))
    expect(theme.appearance).toBe('light')
    expect(theme.variables['--background']).toBe('#fefefe')
  })

  it('fits the frame to the height its own page reports', () => {
    const { container } = render(<HtmlRender page={page} />)
    const box = container.querySelector('.html-render') as HTMLElement
    expect(box.style.height).toBe('300px')
    post(window, size(900))
    expect(box.style.height).toBe('300px')
    post(frameOf().contentWindow, size(900))
    expect(box.style.height).toBe('900px')
  })

  it('pushes the app theme to the page when it switches', async () => {
    render(<HtmlRender page={page} />)
    const frame = frameOf()
    const sent = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    await act(async () => {
      document.documentElement.dataset.theme = 'dark'
    })
    expect(sent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'ui/notifications/host-context-changed',
        params: expect.objectContaining({ theme: 'dark' }),
      }),
      '*',
    )
  })

  it('opens http links only for a focused frame the reader is using', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<HtmlRender page={page} />)
    const frame = frameOf()
    post(frame.contentWindow, link('https://example.com'))
    expect(open).not.toHaveBeenCalled()
    frame.focus()
    vi.stubGlobal('navigator', { ...navigator, userActivation: { isActive: true } })
    post(frame.contentWindow, link('javascript:alert(1)'))
    post(frame.contentWindow, link('https://example.com'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  it('opens full screen in a second frame', () => {
    render(<HtmlRender page={page} />)
    fireEvent.click(screen.getByRole('button', { name: '全屏查看' }))
    expect(screen.getAllByTitle('CPU 走势')).toHaveLength(2)
  })
})

describe('html render palettes', () => {
  it('match the design tokens, for pages shown without the app', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/styles/tokens.css'), 'utf8')
    const block = (selector: string) =>
      css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)))
    for (const [appearance, selector] of [
      ['light', '[data-theme="light"] {'],
      ['dark', '[data-theme="dark"] {'],
    ] as const) {
      const body = block(selector)
      for (const [name, value] of Object.entries(HTML_RENDER_PALETTES[appearance])) {
        const own =
          new RegExp(`\\s${name}:\\s*([^;]+);`).exec(body)?.[1] ??
          new RegExp(`\\s${name}:\\s*([^;]+);`).exec(block(':root,'))?.[1]
        expect(own?.trim(), `${appearance} ${name}`).toBe(value)
      }
    }
  })
})
