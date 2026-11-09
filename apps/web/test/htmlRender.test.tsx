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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)))
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

  it('opens a clicked page image in the zoomable viewer, only for a frame the reader is using', () => {
    render(<HtmlRender page={page} />)
    const frame = frameOf()
    const image = (src: string) => ({
      jsonrpc: '2.0',
      method: 'gg/open-image',
      params: { src, alt: 'chart.png' },
    })
    post(frame.contentWindow, image('data:image/png;base64,AAAA'))
    expect(screen.queryByRole('dialog')).toBeNull()
    frame.focus()
    vi.stubGlobal('navigator', { ...navigator, userActivation: { isActive: true } })
    post(frame.contentWindow, image('data:image/png;base64,AAAA'))
    const viewer = screen.getByRole('dialog', { name: 'chart.png' })
    expect(viewer.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('opens full screen in a second frame', () => {
    render(<HtmlRender page={page} />)
    fireEvent.click(screen.getByRole('button', { name: '全屏查看' }))
    expect(screen.getAllByTitle('CPU 走势')).toHaveLength(2)
  })

  it('shows a placeholder until the page has loaded', () => {
    const { container } = render(<HtmlRender page={page} />)
    const box = container.querySelector('.html-render') as HTMLElement
    expect(box.classList.contains('html-render--loading')).toBe(true)
    fireEvent.load(frameOf())
    expect(box.classList.contains('html-render--loading')).toBe(false)
  })

  it('checks the loaded page and shows a readable state instead of the error body when its file is gone', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const { container } = render(<HtmlRender page={page} />)
    await act(async () => {
      fireEvent.load(frameOf())
    })
    expect(fetch).toHaveBeenCalledWith('/api/attachments/a1/render', { method: 'HEAD' })
    expect(screen.queryByTitle('CPU 走势')).toBeNull()
    expect(screen.getByText('页面内容已不存在')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '全屏查看' })).toBeNull()
    const box = container.querySelector('.html-render') as HTMLElement
    expect(box.style.height).toBe('')
    expect(box.classList.contains('html-render--loading')).toBe(false)
  })

  it('offers a retry when the page failed to load for another reason', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    render(<HtmlRender page={page} />)
    await act(async () => {
      fireEvent.load(frameOf())
    })
    expect(screen.getByText('页面加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await act(async () => {
      fireEvent.load(frameOf())
    })
    expect(screen.queryByText('页面加载失败')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('fits the full-screen frame to its page, up to the viewport', () => {
    render(<HtmlRender page={page} />)
    fireEvent.click(screen.getByRole('button', { name: '全屏查看' }))
    const full = screen.getAllByTitle('CPU 走势')[1] as HTMLIFrameElement
    post(full.contentWindow, size(420))
    expect(full.style.getPropertyValue('--page-height')).toBe('420px')
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

describe('rich reply width', () => {
  it('lets a reply with UI blocks or pages run as wide as a plain reply; a page keeps its own 720px', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/features/rich/rich.css'), 'utf8')
    const rules = (selector: string) =>
      [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter(([, sel]) => sel!.split(',').some((s) => s.trim() === selector))
        .map(([, , body]) => body)
        .join('')
    expect(rules('.rich-reply')).not.toContain('max-width')
    expect(rules('.rich-reply--pages')).not.toContain('max-width')
    const page = readFileSync(join(import.meta.dirname, '../src/features/rich/html-render.css'), 'utf8')
    expect(page).toMatch(/\.html-render \{[^}]*width: 720px;[^}]*max-width: 100%;/)
  })
})
