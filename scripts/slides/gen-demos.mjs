// Renders previews/<id>-demo.webp for every slides template: the first slides cycling, for the hover preview.
// Usage: node scripts/slides/gen-demos.mjs [template-id...]   (needs ffmpeg and img2webp from libwebp)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { chromium } from '@playwright/test'

const ROOT = join(import.meta.dirname, '../../apps/server/plugins/official/slides')
const SKILL = join(ROOT, 'skills/slides')
const FRAMES = 4
// Self-made templates use the fixed 1920×1080 stage: shoot it whole and crop to the 5:4 card; others reflow at 5:4.
const STAGE = { 'new-chinese': 570 }
const manifest = JSON.parse(readFileSync(join(ROOT, 'gonggong-plugin.json'), 'utf8'))
const only = process.argv.slice(2)

const server = createServer((req, res) => {
  const file = join(SKILL, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(SKILL) || !existsSync(file)) return res.writeHead(404).end()
  let body = readFileSync(file)
  if (file.endsWith('guizang-ppt/assets/template.html'))
    body = body
      .toString()
      .replace(
        '<!-- SLIDES_HERE -->',
        readFileSync(join(SKILL, 'templates/guizang-ppt/assets/example-slides.html'), 'utf8'),
      )
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)]
  res.writeHead(200, type ? { 'content-type': type } : {}).end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
for (const t of manifest.templates) {
  if (only.length && !only.includes(t.id)) continue
  const entry = existsSync(join(SKILL, 'templates', t.id, 'example.html'))
    ? `templates/${t.id}/example.html`
    : t.id === 'guizang-ppt'
      ? 'templates/guizang-ppt/assets/template.html'
      : 'templates/html-ppt/templates/full-decks/pitch-deck/index.html'
  const stage =
    existsSync(join(SKILL, 'templates', t.id, 'example.html')) &&
    readFileSync(join(SKILL, 'templates', t.id, 'example.html'), 'utf8').includes('Stage kernel')
  const size = stage ? { width: 1920, height: 1080 } : { width: 1350, height: 1080 }
  const page = await browser.newPage({ viewport: size })
  await page.goto(`${base}/${entry}`, { waitUntil: 'load' }).catch(() => {})
  await page.waitForTimeout(1500)
  const total = await page.evaluate(() => window.deckToolkit.slides().length)
  const dir = mkdtempSync(join(tmpdir(), 'demo-'))
  for (let i = 0; i < Math.min(FRAMES, total); i++) {
    await page.evaluate((n) => window.deckToolkit.go(n), i)
    await page.waitForTimeout(1600)
    await page.screenshot({
      path: join(dir, `${i}.png`),
      clip: stage ? { x: STAGE[t.id] ?? 0, y: 0, width: 1350, height: 1080 } : { x: 0, y: 0, ...size },
    })
  }
  await page.close()
  const out = join(ROOT, 'previews', `${t.id}-demo.webp`)
  const frames = []
  for (let i = 0; i < Math.min(FRAMES, total); i++) {
    const small = join(dir, `s${i}.png`)
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      join(dir, `${i}.png`),
      '-vf',
      'scale=480:384:flags=lanczos',
      small,
    ])
    frames.push(small)
  }
  execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '50', '-d', '1300', ...frames, '-o', out])
  rmSync(dir, { recursive: true })
  console.log(`${t.id}-demo.webp`)
}
await browser.close()
server.close()
