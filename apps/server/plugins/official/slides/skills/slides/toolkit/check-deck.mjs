#!/usr/bin/env node
// Static check of a built deck: node check-deck.mjs design/<slug>/index.html
// Reports problems a browser would hide: broken inline scripts, bad notes JSON,
// slides without a unique data-section, missing toolkit, links that do not resolve
// or leave the deck folder. Exit code 1 when anything is wrong.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { Script } from 'node:vm'

export function checkDeck(file, { allowOutside = false } = {}) {
  const html = readFileSync(file, 'utf8')
  const dir = dirname(resolve(file))
  const problems = []
  const lineOf = (i) => html.slice(0, i).split('\n').length

  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? ''
    const body = m[2] ?? ''
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase()
    if (/\bsrc\s*=/i.test(attrs) || !body.trim()) continue
    if (type && /json/.test(type)) {
      try {
        const v = JSON.parse(body)
        if (/id\s*=\s*["']speaker-notes["']/i.test(attrs) && !Array.isArray(v))
          problems.push(`line ${lineOf(m.index)}: #speaker-notes must be a JSON array, one entry per slide`)
      } catch (e) {
        problems.push(`line ${lineOf(m.index)}: JSON script does not parse — ${e.message}`)
      }
    } else if (!type || /javascript|ecmascript|^module$/.test(type)) {
      try {
        new Script(body, { filename: file })
      } catch (e) {
        if (!(type === 'module' && /import|export/.test(e.message)))
          problems.push(`line ${lineOf(m.index)}: inline script has a syntax error — ${e.message}`)
      }
    }
  }

  const ids = new Map()
  let slides = 0
  for (const m of html.matchAll(/<(section|div|article)\b[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
    if (!(m[2] ?? '').split(/\s+/).includes('slide')) continue
    slides++
    const id = /\bdata-section\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1]
    if (!id) problems.push(`line ${lineOf(m.index)}: slide without data-section`)
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))
      problems.push(`line ${lineOf(m.index)}: data-section "${id}" is not kebab-case`)
    else if (ids.has(id)) problems.push(`line ${lineOf(m.index)}: data-section "${id}" repeats line ${ids.get(id)}`)
    else ids.set(id, lineOf(m.index))
  }
  if (!slides) problems.push('no slides found (elements with class "slide")')

  const head = html.split(/<\/head>/i)[0] ?? ''
  if (!/<script\b[^>]*\bsrc\s*=\s*["'][^"']*deck-toolkit\.js["']/i.test(head))
    problems.push('deck-toolkit.js is not loaded in <head>')

  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = (m[1] ?? '').split(/[?#]/)[0] ?? ''
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(m[1] ?? '') || ref.includes('${')) continue
    const target = resolve(dir, decodeURIComponent(ref))
    if (!allowOutside && relative(dir, target).startsWith('..'))
      problems.push(`line ${lineOf(m.index)}: ${m[1]} points outside the deck folder`)
    else if (!existsSync(target)) problems.push(`line ${lineOf(m.index)}: ${m[1]} does not exist`)
  }
  return { slides, problems }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: node check-deck.mjs design/<slug>/index.html')
    process.exit(2)
  }
  const { slides, problems } = checkDeck(file)
  for (const p of problems) console.log(`✗ ${p}`)
  console.log(problems.length ? `${problems.length} problem(s)` : `✓ ${slides} slides, no problems`)
  process.exit(problems.length ? 1 : 0)
}
