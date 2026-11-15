#!/usr/bin/env node
// Keeps source files from growing past LIMIT lines. Files already over it are pinned in size-baseline.json and may
// only shrink; `--update` rewrites the baseline after a file shrinks (entries are only ever lowered or dropped).
// Usage: node scripts/check-size.mjs [--update]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const LIMIT = 1000

const SOURCE =
  /^(apps\/[^/]+\/src|packages\/[^/]+\/src|crates|apps\/desktop\/src-tauri)\/.*\.(ts|tsx|rs|css)$/
const EXCLUDED = [
  /\.test\.tsx?$/,
  /\/tests?\//,
  /\/tests\.rs$/,
  /\/drizzle\//,
  /(^|\/)(i18n-)?en\.(ts|rs)$/, // English dictionaries mirror the Chinese text one entry per line
  /^apps\/server\/src\/db\/schema\.ts$/, // the one place every table is defined (AGENTS.md)
]

export const inScope = (path) => SOURCE.test(path) && !EXCLUDED.some((re) => re.test(path))

/** Messages for files over the limit (new ones) or over their baseline (pinned ones). */
export function checkSizes(sizes, baseline) {
  const errors = []
  for (const [path, lines] of Object.entries(sizes)) {
    const max = Math.max(LIMIT, baseline[path] ?? 0)
    if (lines <= max) continue
    errors.push(
      path in baseline
        ? `${path}: ${lines} lines, baseline ${max} (split it or move code out)`
        : `${path}: ${lines} lines, limit ${LIMIT} (split it into smaller files)`,
    )
  }
  return errors
}

export function updatedBaseline(sizes, baseline) {
  const next = {}
  for (const [path, max] of Object.entries(baseline)) {
    const lines = sizes[path]
    if (lines > LIMIT) next[path] = Math.min(lines, max)
  }
  return next
}

const countLines = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

function measure(root) {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
  const sizes = {}
  for (const path of files.split('\n').filter(inScope)) {
    try {
      sizes[path] = countLines(readFileSync(new URL(path, root), 'utf8'))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e // deleted in the work tree but still in the index
    }
  }
  return sizes
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url)
  const baselineFile = new URL('size-baseline.json', import.meta.url)
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'))
  const sizes = measure(root)
  if (process.argv.includes('--update')) {
    const next = updatedBaseline(sizes, baseline)
    writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`size baseline: ${Object.keys(baseline).length} → ${Object.keys(next).length} entries`)
  }
  const errors = checkSizes(sizes, baseline)
  if (errors.length) {
    console.error(`✗ files over the size limit:\n${errors.map((e) => `  ${e}`).join('\n')}`)
    process.exit(1)
  }
}
