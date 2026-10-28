import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HTML_RENDER_MAX_FIT_HEIGHT,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_TOKENS,
  type HtmlRenderRef,
  htmlRenderFrameHeight,
  htmlRenderPreviewStyles,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  injectHtmlRenderBootstrap,
  paletteTheme,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
} from '../src/index.js'

const ref = (o: Partial<HtmlRenderRef> = {}): HtmlRenderRef => ({
  attachmentId: 'a',
  title: '图',
  height: 400,
  ...o,
})

describe('html render frame height', () => {
  it('fits the live page, bounded', () => {
    expect(htmlRenderFrameHeight(ref(), 720, 1234.2)).toBe(1235)
    expect(htmlRenderFrameHeight(ref(), 720, 10)).toBe(HTML_RENDER_MIN_HEIGHT)
    expect(htmlRenderFrameHeight(ref(), 720, 1e9)).toBe(HTML_RENDER_MAX_FIT_HEIGHT)
  })

  it('uses the agent height without measurements', () => {
    expect(htmlRenderFrameHeight(ref({ height: 300 }), 500)).toBe(300)
  })

  it('takes the taller neighbouring measurement for the frame width', () => {
    const heights: [number, number][] = [
      [320, 900],
      [640, 500],
      [720, 400],
      [1000, 380],
    ]
    expect(htmlRenderFrameHeight(ref({ height: 400, heights }), 720)).toBe(400)
    expect(htmlRenderFrameHeight(ref({ height: 400, heights }), 500)).toBe(900)
    expect(htmlRenderFrameHeight(ref({ height: 400, heights }), 2000)).toBe(400)
  })

  it('keeps an agent-chosen frame shorter than the page', () => {
    const heights: [number, number][] = [[720, 3000]]
    expect(htmlRenderFrameHeight(ref({ height: 600, heights }), 720)).toBe(600)
    expect(htmlRenderFrameHeight(ref({ height: 2000, heights: [[720, 1500]] }), 720)).toBe(1500)
    expect(htmlRenderFrameHeight(ref({ height: 2000, heights: [[720, 9000]] }), 720)).toBe(
      HTML_RENDER_MAX_HEIGHT,
    )
  })
})

describe('html render bootstrap', () => {
  it('goes at the start of the real head, not one inside a comment or script', () => {
    const html = '<!doctype html><!-- <head> --><html><head><title>x</title></head><body>hi</body></html>'
    const out = injectHtmlRenderBootstrap(html)
    expect(out.indexOf('<style id="gg-theme">')).toBeGreaterThan(out.indexOf('<html><head>'))
    expect(out).toContain('<!-- <head> -->')
    expect(out).toContain('<meta charset="utf-8">')
  })

  it('makes a head for a fragment and keeps the page charset and viewport', () => {
    expect(injectHtmlRenderBootstrap('<p>hi</p>')).toMatch(
      /^<!doctype html><head><meta charset="utf-8">.*<\/head><p>hi<\/p>$/s,
    )
    const own = injectHtmlRenderBootstrap(
      '<html><head><meta charset="gbk"><meta name="viewport" content="width=500"></head></html>',
    )
    expect(own).not.toContain('charset="utf-8"')
    expect(own.match(/name="viewport"/g)).toHaveLength(1)
    expect(injectHtmlRenderBootstrap('<!DOCTYPE html><body>x</body>')).toMatch(/^<!DOCTYPE html><head>/)
  })

  it('defaults to both palettes and reports size, theme and links over JSON-RPC', () => {
    const out = injectHtmlRenderBootstrap('<p>x</p>')
    expect(out).toContain('@media (prefers-color-scheme: dark)')
    expect(out).toContain('ui/notifications/size-changed')
    expect(out).toContain('ui/notifications/host-context-changed')
    expect(out).toContain('ui/open-link')
  })
})

describe('html render messages', () => {
  it('reads heights and http links only', () => {
    expect(
      readHtmlRenderContentHeight({
        jsonrpc: '2.0',
        method: 'ui/notifications/size-changed',
        params: { height: 320 },
      }),
    ).toBe(320)
    expect(
      readHtmlRenderContentHeight({
        jsonrpc: '2.0',
        method: 'ui/notifications/size-changed',
        params: { height: -1 },
      }),
    ).toBeUndefined()
    expect(
      readHtmlRenderContentHeight({ method: 'ui/notifications/size-changed', params: { height: 3 } }),
    ).toBeUndefined()
    const link = (url: string) => ({
      jsonrpc: '2.0',
      id: 'gg-link-1',
      method: 'ui/open-link',
      params: { url },
    })
    expect(readHtmlRenderLinkRequest(link('https://example.com/a'))).toEqual({
      id: 'gg-link-1',
      url: 'https://example.com/a',
    })
    expect(readHtmlRenderLinkRequest(link('javascript:alert(1)'))).toBeUndefined()
  })

  it('carries every page variable in the theme', () => {
    const theme = htmlRenderTheme('dark', (name) => `v(${name})`)
    expect(theme.variables['--background']).toBe('v(--content-bg)')
    expect(Object.keys(theme.variables)).toHaveLength(Object.keys(HTML_RENDER_TOKENS).length + 1)
    for (const appearance of ['light', 'dark'] as const)
      expect(Object.values(paletteTheme(appearance).variables).every(Boolean)).toBe(true)
    expect(htmlRenderThemeMessage(theme).params.styles.variables).toBe(theme.variables)
    const fragment = htmlRenderThemeFragment(theme)
    expect(JSON.parse(decodeURIComponent(fragment.slice('#gg-theme='.length)))).toEqual(theme)
  })

  it('html-render-preview.json (read by the daemon) matches the palettes', () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'html-render-preview.json'), 'utf8'))
    expect(file).toEqual(htmlRenderPreviewStyles())
  })
})
