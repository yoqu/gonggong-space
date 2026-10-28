import { z } from 'zod'

// ── Inline HTML renders (plan 即时 HTML，参考 t3code): an agent publishes a self-contained page with the daemon's
// `html_render` tool; it is stored as an attachment and shown as its own message in a sandboxed frame. The page
// talks to the host with MCP Apps JSON-RPC messages (size, theme, links).

export const HTML_RENDER_HTML_MAX = 512_000
export const HTML_RENDER_TITLE_MAX = 200
export const HTML_RENDER_MIN_HEIGHT = 80
export const HTML_RENDER_MAX_HEIGHT = 2000
/** A client fits the frame to the live page up to this height: it only stops a page that grows with its frame. */
export const HTML_RENDER_MAX_FIT_HEIGHT = 20_000
/** The wide reply column (`.tl-msg--wide`), what an agent should design for. */
export const HTML_RENDER_COLUMN_WIDTH = 720
/** Widths the daemon measures a published page at, so the frame starts at the right height. */
export const HTML_RENDER_MEASURE_WIDTHS = [320, 375, 430, 520, 640, 720, 860, 1000, 1144] as const

export const clampHtmlRenderHeight = (height: number) =>
  Math.min(HTML_RENDER_MAX_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, Math.round(height)))

/** MessageDto.htmlRender: the page's attachment and the heights it was published with. */
export const HtmlRenderRef = z.object({
  attachmentId: z.string(),
  title: z.string().min(1).max(HTML_RENDER_TITLE_MAX),
  height: z.number().int().min(HTML_RENDER_MIN_HEIGHT).max(HTML_RENDER_MAX_HEIGHT),
  /** [width, height] pairs by width, measured by the daemon; absent when it had no browser. */
  heights: z
    .array(z.tuple([z.number().int().min(1).max(10_000), z.number().int().min(0)]))
    .max(24)
    .optional(),
})
export type HtmlRenderRef = z.infer<typeof HtmlRenderRef>

// Use the taller neighbouring measurement: a breakpoint between them may pick either height.
function measuredHeight(heights: [number, number][], width: number) {
  const above = heights.findIndex(([w]) => w >= width)
  const high = above === -1 ? heights.length - 1 : above
  const low = heights[high]?.[0] === width ? high : Math.max(0, high - 1)
  return Math.max(heights[low]?.[1] ?? 0, heights[high]?.[1] ?? 0)
}

/**
 * A page even a few pixels taller than its frame scrolls inside it and takes the reader's scroll, so the frame fits
 * the page. The live page's `contentHeight` wins: client fonts often wrap it taller than it was measured.
 */
export function htmlRenderFrameHeight(ref: HtmlRenderRef, width: number, contentHeight?: number) {
  if (contentHeight !== undefined)
    return Math.min(HTML_RENDER_MAX_FIT_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, Math.ceil(contentHeight)))
  const heights = ref.heights
  if (!heights?.length) return clampHtmlRenderHeight(ref.height)
  // An agent that chose a shorter frame than the page meant it (e.g. a long table that scrolls).
  const cap =
    measuredHeight(heights, HTML_RENDER_COLUMN_WIDTH) > ref.height ? ref.height : HTML_RENDER_MAX_HEIGHT
  return clampHtmlRenderHeight(Math.min(cap, measuredHeight(heights, width)))
}

// ── Theme: the app's design tokens under the variable names an agent writes against ─────────────────────────────

/** Page variable → app design token (`apps/web/src/styles/tokens.css`). */
export const HTML_RENDER_TOKENS = {
  '--background': '--content-bg',
  '--foreground': '--label',
  '--muted': '--tint-gray',
  '--muted-foreground': '--label-secondary',
  '--card': '--bubble-in',
  '--card-foreground': '--label',
  '--popover': '--window-bg',
  '--popover-foreground': '--label',
  '--secondary': '--tint-gray',
  '--secondary-foreground': '--label',
  '--border': '--separator',
  '--input': '--control-stroke',
  '--ring': '--focus-ring',
  '--primary': '--accent-fill',
  '--primary-foreground': '--on-accent',
  '--accent': '--accent',
  '--accent-foreground': '--on-accent',
  '--accent-surface': '--tint-blue',
  '--accent-surface-foreground': '--tint-blue-text',
  '--destructive': '--system-red',
  '--destructive-foreground': '--tint-red-text',
  '--destructive-surface': '--tint-red',
  '--warning': '--system-orange',
  '--warning-foreground': '--tint-orange-text',
  '--warning-surface': '--tint-orange',
  '--success': '--system-green',
  '--success-foreground': '--tint-green-text',
  '--success-surface': '--tint-green',
  '--info': '--system-blue',
  '--info-foreground': '--tint-blue-text',
  '--code-background': '--group-bg',
  '--code-foreground': '--label',
  '--chart-1': '--accent',
  '--chart-2': '--system-orange',
  '--chart-3': '--system-green',
  '--chart-4': '--system-purple',
  '--chart-5': '--system-pink',
  '--chart-6': '--system-teal',
  '--font-sans': '--font-sans',
  '--font-mono': '--font-mono',
} as const

export type HtmlRenderAppearance = 'light' | 'dark'

const FONTS = {
  '--font-sans':
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "PingFang SC", "Helvetica Neue", system-ui, sans-serif',
  '--font-mono': 'ui-monospace, "SF Mono", Menlo, monospace',
}

/** The tokens' values per appearance, for a page shown without the app (the daemon's preview, a direct open). */
export const HTML_RENDER_PALETTES: Record<HtmlRenderAppearance, Record<string, string>> = {
  light: {
    '--content-bg': '#ffffff',
    '--label': '#000000d9',
    '--label-secondary': '#00000094',
    '--tint-gray': '#ececef',
    '--bubble-in': '#f0f0f2',
    '--window-bg': '#f5f5f5',
    '--separator': '#0000001a',
    '--control-stroke': '#00000024',
    '--focus-ring': '#0080f0',
    '--accent-fill': '#0071e3',
    '--on-accent': '#ffffff',
    '--accent': '#0088ff',
    '--tint-blue': '#e0efff',
    '--tint-blue-text': '#0060c0',
    '--system-red': '#ff383c',
    '--tint-red-text': '#c01f1c',
    '--tint-red': '#ffe6e5',
    '--system-orange': '#ff8d28',
    '--tint-orange-text': '#a34a00',
    '--tint-orange': '#ffefdf',
    '--system-green': '#34c759',
    '--tint-green-text': '#1a7a36',
    '--tint-green': '#e2f5e7',
    '--system-blue': '#0088ff',
    '--group-bg': '#0000000a',
    '--system-purple': '#cb30e0',
    '--system-pink': '#ff2d55',
    '--system-teal': '#00c3d0',
    ...FONTS,
  },
  dark: {
    '--content-bg': '#161616',
    '--label': '#ffffffd9',
    '--label-secondary': '#ffffff8c',
    '--tint-gray': '#2e2e31',
    '--bubble-in': '#2c2c2e',
    '--window-bg': '#1e1e1e',
    '--separator': '#ffffff1a',
    '--control-stroke': '#ffffff1f',
    '--focus-ring': '#0091ff',
    '--accent-fill': '#0071e3',
    '--on-accent': '#ffffff',
    '--accent': '#0091ff',
    '--tint-blue': '#0d2a47',
    '--tint-blue-text': '#6cb6ff',
    '--system-red': '#ff4245',
    '--tint-red-text': '#ff8080',
    '--tint-red': '#421414',
    '--system-orange': '#ff9230',
    '--tint-orange-text': '#ffab5e',
    '--tint-orange': '#3d2410',
    '--system-green': '#30d158',
    '--tint-green-text': '#4cd774',
    '--tint-green': '#0f3319',
    '--system-blue': '#0091ff',
    '--group-bg': '#ffffff0d',
    '--system-purple': '#db34f2',
    '--system-pink': '#ff375f',
    '--system-teal': '#00d2e0',
    ...FONTS,
  },
}

export interface HtmlRenderTheme {
  appearance: HtmlRenderAppearance
  variables: Record<string, string>
}

/** The page theme from token values (`token` reads one: the live app's computed style, or a palette). */
export function htmlRenderTheme(
  appearance: HtmlRenderAppearance,
  token: (name: string) => string,
): HtmlRenderTheme {
  const variables: Record<string, string> = { '--radius': '10px' }
  for (const [name, source] of Object.entries(HTML_RENDER_TOKENS)) variables[name] = token(source)
  return { appearance, variables }
}

export const paletteTheme = (appearance: HtmlRenderAppearance) =>
  htmlRenderTheme(appearance, (name) => HTML_RENDER_PALETTES[appearance][name] ?? '')

/** Agent-facing (not translated). */
export const HTML_RENDER_THEME_GUIDE = [
  'Use theme CSS variables, not fixed colors:',
  '--background, --foreground, --muted, --card, --popover, --secondary, --border, --ring, --primary, --accent, --destructive, --warning, --success, --info, --code-background',
  '(most have -foreground; accent, destructive, warning, success also -surface),',
  '--chart-1..6, --radius, --font-sans, --font-mono. The base sheet sets background, 14px text and font, and follows the reader’s light/dark theme.',
].join(' ')

/** Agent-facing (not translated). */
export const HTML_RENDER_LAYOUT_GUIDE = [
  `Width is the reply column (${HTML_RENDER_COLUMN_WIDTH}px desktop, ~360px phones) on the chat background.`,
  'html, body and the outer element get no background, outer card, border, banner title or side padding (overrides any page-background rule).',
  'An inner box with its own background gets 16px padding and var(--radius). Charts get fixed pixel heights.',
  'Content sets the height: no vh units (rejected) or height:100% on html/body (loops).',
  'A clicked image opens in the host’s zoomable viewer; build no lightbox. Image facts (resolution, size, path) go as small tags over its bottom-left corner, not a block of their own.',
].join(' ')

// ── Host ↔ page messages (MCP Apps JSON-RPC) ─────────────────────────────────────────────────────────────────────

const HOST_CONTEXT_CHANGED = 'ui/notifications/host-context-changed'
const OPEN_LINK = 'ui/open-link'
/** Not in MCP Apps: a clicked page image opens in the host's zoomable viewer, the frame being too small for it. */
const OPEN_IMAGE = 'gg/open-image'
const SIZE_CHANGED = 'ui/notifications/size-changed'

const rpc = (data: unknown, method: string) => {
  if (typeof data !== 'object' || data === null) return undefined
  const d = data as { jsonrpc?: unknown; method?: unknown; id?: unknown; params?: unknown }
  if (d.jsonrpc !== '2.0' || d.method !== method || typeof d.params !== 'object' || d.params === null)
    return undefined
  return { id: d.id, params: d.params as Record<string, unknown> }
}

export function readHtmlRenderContentHeight(data: unknown): number | undefined {
  const height = rpc(data, SIZE_CHANGED)?.params.height
  return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : undefined
}

export function readHtmlRenderLinkRequest(data: unknown): { id: string | number; url: string } | undefined {
  const m = rpc(data, OPEN_LINK)
  const url = m?.params.url
  if (!m || (typeof m.id !== 'string' && typeof m.id !== 'number')) return undefined
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? { id: m.id, url } : undefined
}

/** Inlined (data:image) or http(s) images only: the host shows the src in its own document. */
export function readHtmlRenderImageRequest(data: unknown): { src: string; alt: string } | undefined {
  const p = rpc(data, OPEN_IMAGE)?.params
  const src = p?.src
  if (typeof src !== 'string' || !/^(?:data:image\/[\w.+-]+[;,]|https?:\/\/)/i.test(src)) return undefined
  return { src, alt: typeof p?.alt === 'string' ? p.alt : '' }
}

export const htmlRenderResult = (id: string | number) => ({ jsonrpc: '2.0', id, result: {} }) as const

export const htmlRenderThemeMessage = (theme: HtmlRenderTheme) =>
  ({
    jsonrpc: '2.0',
    method: HOST_CONTEXT_CHANGED,
    params: { theme: theme.appearance, styles: { variables: theme.variables } },
  }) as const

const THEME_FRAGMENT = 'gg-theme'

/** The first theme rides in the URL fragment so the page paints in it; the bootstrap strips it before page scripts. */
export const htmlRenderThemeFragment = (theme: HtmlRenderTheme) =>
  `#${THEME_FRAGMENT}=${encodeURIComponent(JSON.stringify(theme))}`

// ── Bootstrap: injected into every published page ────────────────────────────────────────────────────────────────

const BASE_CSS =
  'html{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}' +
  'html::-webkit-scrollbar{display:none}body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}' +
  // Focus outlines paint inside the element, so the frame edge never clips them.
  ':where(:focus-visible){outline:2px solid var(--ring)}:focus-visible{outline-width:2px!important;outline-offset:-2px!important}' +
  ':where(img):not(a img,button img){cursor:zoom-in}'

const rootRule = (theme: HtmlRenderTheme) =>
  `:root{color-scheme:${theme.appearance};${Object.entries(theme.variables)
    .map(([k, v]) => `${k}:${v};`)
    .join('')}}`

/** The theme sheet alone, as the daemon injects it to preview or measure a page in one appearance. */
export const htmlRenderPreviewStyle = (appearance: HtmlRenderAppearance) =>
  `<style id="gg-theme">${rootRule(paletteTheme(appearance))}${BASE_CSS}</style>`

// Applies the fragment's theme before paint and follows host theme changes; reports the content height; sends
// http(s) link clicks to the host (an opaque-origin frame cannot open them usefully itself), and image clicks the
// page itself did not handle.
const BOOTSTRAP_SCRIPT = `(function(){var s=document.getElementById("gg-theme"),n=0;if(!s)return;var b=${JSON.stringify(BASE_CSS)};function a(t){if(!t||typeof t!=="object"||!t.variables||typeof t.variables!=="object")return;var c=":root{color-scheme:"+(t.appearance==="dark"?"dark":"light")+";";for(var k in t.variables){if(/^--[a-z0-9-]+$/.test(k))c+=k+":"+String(t.variables[k]).replace(/[;{}<>]/g,"")+";";}s.textContent=c+"}"+b;}try{var m=/[#&]${THEME_FRAGMENT}=([^&]*)/.exec(location.hash);if(m){a(JSON.parse(decodeURIComponent(m[1])));history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;if(e.source===window.parent&&d&&d.jsonrpc==="2.0"&&d.method===${JSON.stringify(HOST_CONTEXT_CHANGED)}&&p&&p.styles)a({appearance:p.theme,variables:p.styles.variables});});document.addEventListener("click",function(e){var l=e.isTrusted?e.composedPath().find(function(t){return t&&t.matches&&t.matches("a[href]");}):null,u;if(!l)return;try{u=new URL(l.getAttribute("href"),document.baseURI);}catch(x){return;}if(!/^https?:$/.test(u.protocol)||u.href.split("#")[0]===location.href.split("#")[0])return;if(window.parent!==window){e.preventDefault();window.parent.postMessage({jsonrpc:"2.0",id:"gg-link-"+(++n),method:${JSON.stringify(OPEN_LINK)},params:{url:u.href}},"*");}else{l.setAttribute("target","_blank");l.setAttribute("rel","noopener");}},true);if(window.parent!==window){var h,o,z=function(){var r=document.documentElement,v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);if(v===h)return;h=v;window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(SIZE_CHANGED)},params:{height:v}},"*");};if(window.ResizeObserver){o=new ResizeObserver(z);o.observe(document.documentElement);}document.addEventListener("DOMContentLoaded",function(){if(o&&document.body)o.observe(document.body);z();});window.addEventListener("load",z);window.addEventListener("click",function(e){var i=e.target;if(!e.isTrusted||e.defaultPrevented||!i||i.tagName!=="IMG"||i.closest("a[href],button")||!(i.currentSrc||i.src))return;window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(OPEN_IMAGE)},params:{src:i.currentSrc||i.src,alt:i.alt||""}},"*");});}})();`

function bootstrapMarkup(scan: string) {
  const css = `${rootRule(paletteTheme('light'))}@media (prefers-color-scheme: dark){${rootRule(paletteTheme('dark'))}}${BASE_CSS}`
  return [
    /<meta\s[^>]*charset/i.test(scan.slice(0, 4096)) ? '' : '<meta charset="utf-8">',
    /<meta\s[^>]*name\s*=\s*["']?viewport/i.test(scan)
      ? ''
      : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style id="gg-theme">${css}</style>`,
    `<script>${BOOTSTRAP_SCRIPT}</script>`,
  ].join('')
}

// Blanks inert content (comments, raw-text elements, templates) without shifting offsets, so a `<head>` inside it
// cannot receive the bootstrap.
function blankNonMarkup(html: string) {
  const scan = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi,
    (m) => ' '.repeat(m.length),
  )
  const parts: string[] = []
  let depth = 0
  let start = 0
  let at = 0
  for (const m of scan.matchAll(/<(\/?)template(?:\s[^>]*)?\/?>/gi)) {
    if (!m[1]) {
      if (depth++ === 0) start = m.index
    } else if (depth > 0 && --depth === 0) {
      const end = m.index + m[0].length
      parts.push(scan.slice(at, start), ' '.repeat(end - start))
      at = end
    }
  }
  if (depth > 0) {
    parts.push(scan.slice(at, start), ' '.repeat(scan.length - start))
    at = scan.length
  }
  parts.push(scan.slice(at))
  return parts.join('')
}

/** `html` with the theme sheet and bridge script at the start of its head (one is made when missing). */
export function injectHtmlRenderBootstrap(html: string) {
  const scan = blankNonMarkup(html)
  const markup = bootstrapMarkup(scan)
  const head = /<head(?:\s[^>]*)?>/i.exec(scan)
  if (head) {
    const at = head.index + head[0].length
    return html.slice(0, at) + markup + html.slice(at)
  }
  const root = /<html(?:\s[^>]*)?>/i.exec(scan)
  if (root) {
    const at = root.index + root[0].length
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype) {
    const at = doctype[0].length
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`
  }
  return `<!doctype html><head>${markup}</head>${html}`
}

/** What the daemon includes (`html-render-preview.json`): the sheet it injects per appearance. */
export const htmlRenderPreviewStyles = () => ({
  light: htmlRenderPreviewStyle('light'),
  dark: htmlRenderPreviewStyle('dark'),
})
