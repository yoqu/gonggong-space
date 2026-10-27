import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

export type TerminalLink =
  | { kind: 'url'; text: string; url: string }
  | { kind: 'file'; text: string; path: string; line: number; column: number }

type Options = {
  resolveFile: (path: string, line: number, column: number) => void | Promise<void>
  openUrl: (url: string) => void
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu
const FILE_PATTERN = /(?:\.\/)?(?:[\w@+.~-]+\/)*[\w@+.~-]+\.[A-Za-z0-9_~-]+(?::([1-9]\d*)(?::([1-9]\d*))?)?/gu
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u
const DOMAIN = /^(?:localhost|(?:[\w-]+\.)+(?:com|net|org|io|dev|app|cn|edu|gov))(?::\d+)?$/iu

export function safeWorkspacePath(raw: string): string | null {
  if (!raw || raw.length > 4096 || /[\0\\]/u.test(raw) || /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(raw)) return null
  if (/%[0-9a-f]{2}/iu.test(raw) || raw.startsWith('/')) return null
  const parts = raw.split('/')
  if (parts.some((part) => part === '..') || parts.at(-1) === '') return null
  return parts.filter((part) => part && part !== '.').join('/') || null
}

function trimUrl(raw: string) {
  let text = raw
  while (true) {
    const trimmed = text.replace(TRAILING_PUNCTUATION, '')
    if (trimmed !== text) {
      text = trimmed
      continue
    }
    const pairs = [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ] as const
    const close = text.at(-1)
    const opener = pairs.find(([, right]) => right === close)?.[0]
    if (!opener || !close) return text
    const opens = text.split(opener).length - 1
    const closes = text.split(close).length - 1
    if (closes <= opens) return text
    text = text.slice(0, -1)
  }
}

function offsets(line: string) {
  const result: number[] = []
  let index = 0
  for (let i = 0; i < line.length; ) {
    const point = line.codePointAt(i) ?? 0
    const units = point > 0xffff ? 2 : 1
    for (let j = 0; j < units; j++) result[i + j] = index
    index +=
      point === 0 || point < 32 || (point >= 0x7f && point < 0xa0)
        ? 0
        : /^\p{Mark}$/u.test(String.fromCodePoint(point))
          ? 0
          : isWide(point)
            ? 2
            : 1
    i += units
  }
  result[line.length] = index
  return result
}

function isWide(point: number) {
  return (
    point >= 0x1100 &&
    (point <= 0x115f ||
      point === 0x2329 ||
      point === 0x232a ||
      (point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f) ||
      (point >= 0xac00 && point <= 0xd7a3) ||
      (point >= 0xf900 && point <= 0xfaff) ||
      (point >= 0xfe10 && point <= 0xfe19) ||
      (point >= 0xfe30 && point <= 0xfe6f) ||
      (point >= 0xff00 && point <= 0xff60) ||
      (point >= 0xffe0 && point <= 0xffe6) ||
      (point >= 0x1f300 && point <= 0x1f64f) ||
      (point >= 0x1f900 && point <= 0x1f9ff) ||
      (point >= 0x20000 && point <= 0x3fffd))
  )
}

export function terminalLineLinks(line: string): (TerminalLink & { start: number; end: number })[] {
  const links: (TerminalLink & { start: number; end: number })[] = []
  for (const match of line.matchAll(URL_PATTERN)) {
    const text = trimUrl(match[0])
    let url: URL
    try {
      url = new URL(text)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    links.push({ kind: 'url', text, url: url.href, start: match.index, end: match.index + text.length })
  }
  for (const match of line.matchAll(FILE_PATTERN)) {
    const start = match.index
    const end = start + match[0].length
    if (links.some((link) => start < link.end && end > link.start)) continue
    if (/[\w@+.~:/\\-]/u.test(line[start - 1] ?? '')) continue
    if (!match[0].includes('/') && !match[1]) continue
    if (DOMAIN.test(match[0])) continue
    if (/^\d+(?:\.\d+)+$/u.test(match[0])) continue
    const scheme = /[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^\s]*$/u.exec(line.slice(0, start))
    if (scheme) continue
    const suffix = match[1] ? match[0].lastIndexOf(`:${match[1]}`) : match[0].length
    const path = safeWorkspacePath(match[0].slice(0, suffix))
    if (!path) continue
    links.push({
      kind: 'file',
      text: match[0],
      path,
      line: Number(match[1] ?? 1),
      column: Number(match[2] ?? 1),
      start,
      end,
    })
  }
  const cells = offsets(line)
  return links
    .sort((a, b) => a.start - b.start)
    .map((link) => ({ ...link, start: cells[link.start] ?? link.start, end: cells[link.end] ?? link.end }))
}

export function parseTerminalLinks(text: string): TerminalLink[] {
  return text
    .split(/\r?\n/u)
    .flatMap((line) => terminalLineLinks(line))
    .map(({ start: _start, end: _end, ...link }) => link)
}

export function createTerminalLinkProvider(terminal: Terminal, options: Options): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) return callback(undefined)
      const text = line.translateToString(true)
      const links = terminalLineLinks(text).map<ILink>((link) => ({
        text: link.text,
        range: {
          start: { x: link.start + 1, y: bufferLineNumber },
          end: { x: link.end, y: bufferLineNumber },
        },
        activate: () => {
          if (link.kind === 'url') options.openUrl(link.url)
          else void options.resolveFile(link.path, link.line, link.column)
        },
      }))
      callback(links.length ? links : undefined)
    },
  }
}
