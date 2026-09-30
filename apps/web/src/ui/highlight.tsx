import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import type { HighlighterCore } from 'shiki/core'
import './highlight.css'

/** Grammars load on first use, each its own chunk. */
const GRAMMARS = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  less: () => import('@shikijs/langs/less'),
  html: () => import('@shikijs/langs/html'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  php: () => import('@shikijs/langs/php'),
  ruby: () => import('@shikijs/langs/ruby'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  sql: () => import('@shikijs/langs/sql'),
  xml: () => import('@shikijs/langs/xml'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  graphql: () => import('@shikijs/langs/graphql'),
  ini: () => import('@shikijs/langs/ini'),
  lua: () => import('@shikijs/langs/lua'),
  dart: () => import('@shikijs/langs/dart'),
  make: () => import('@shikijs/langs/make'),
  prisma: () => import('@shikijs/langs/prisma'),
  proto: () => import('@shikijs/langs/proto'),
}
export type Lang = keyof typeof GRAMMARS

/** Extensions, whole file names and fence aliases that are not a grammar id. */
const ALIASES: Record<string, Lang> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json5: 'jsonc',
  htm: 'html',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  kt: 'kotlin',
  kts: 'kotlin',
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  yml: 'yaml',
  svg: 'xml',
  gql: 'graphql',
  makefile: 'make',
}

export function langFor(alias: string | undefined): Lang | null {
  const key = alias?.toLowerCase() ?? ''
  return key in GRAMMARS ? (key as Lang) : (ALIASES[key] ?? null)
}

export function langOf(name: string): Lang | null {
  const base = (name.split('/').pop() ?? '').toLowerCase()
  const dot = base.lastIndexOf('.')
  return langFor(base === 'dockerfile' || base === 'makefile' || dot < 0 ? base : base.slice(dot + 1))
}

export interface HlToken {
  content: string
  light?: string
  dark?: string
  fontStyle?: number
}

/** Beyond this the file stays plain: tokenizing would stall the page for little benefit. */
const MAX_CHARS = 200_000
/** Longer lines (minified code) stay plain. */
const MAX_LINE = 2_000

let core: Promise<HighlighterCore> | null = null
const loading = new Map<Lang, Promise<void>>()

async function highlighter(lang: Lang) {
  core ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([shiki, engine]) =>
    shiki.createHighlighterCore({
      themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
      langs: [],
      // Plain JS regexes: no WASM download.
      engine: engine.createJavaScriptRegexEngine(),
    }),
  )
  const h = await core
  if (!loading.has(lang))
    loading.set(
      lang,
      GRAMMARS[lang]().then((m) => h.loadLanguage(m.default)),
    )
  await loading.get(lang)
  return h
}

export async function highlight(code: string, lang: Lang): Promise<HlToken[][]> {
  const h = await highlighter(lang)
  return h
    .codeToTokensWithThemes(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      tokenizeMaxLineLength: MAX_LINE,
    })
    .map((line) =>
      line.map((t) => ({
        content: t.content,
        light: t.variants.light?.color,
        dark: t.variants.dark?.color,
        fontStyle: t.variants.light?.fontStyle,
      })),
    )
}

/** Tokens per line once ready; null while loading, for unknown languages and for oversized code. */
export function useHighlight(code: string, lang: Lang | null): HlToken[][] | null {
  const [done, setDone] = useState<{ code: string; lang: Lang; lines: HlToken[][] } | null>(null)
  const skip = !lang || code.length > MAX_CHARS
  useEffect(() => {
    if (skip || !lang) return
    let live = true
    highlight(code, lang).then(
      (lines) => live && setDone({ code, lang, lines }),
      () => {},
    )
    return () => {
      live = false
    }
  }, [code, lang, skip])
  return !skip && done?.code === code && done.lang === lang ? done.lines : null
}

const ITALIC = 1
const BOLD = 2
const UNDERLINE = 4

export function Tokens({ tokens }: { tokens: HlToken[] }) {
  return tokens.map((t, i) => {
    const fs = t.fontStyle ?? 0
    const style = {
      '--hl-l': t.light,
      '--hl-d': t.dark,
      fontStyle: fs & ITALIC ? 'italic' : undefined,
      fontWeight: fs & BOLD ? 600 : undefined,
      textDecoration: fs & UNDERLINE ? 'underline' : undefined,
    } as CSSProperties
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
      <span key={i} className="hl" style={style}>
        {t.content}
      </span>
    )
  })
}
