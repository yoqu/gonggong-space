// S0 spike (docs/plan/产物容器-S0-spike.md): the open-artifact Slides editor behind a minimal capability broker.
// Not part of `pnpm e2e`; run with `pnpm exec playwright test -c e2e/oa-spike` after scripts/build-open-artifact.sh.
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { HOST_ORIGIN } from './ports'

/** OA_SPIKE_SANDBOX / OA_SPIKE_ALLOW: the editor iframe's `sandbox` and `allow`, to try what a real Shell would set. */
function frameQuery() {
  const q = new URLSearchParams()
  if (process.env.OA_SPIKE_SANDBOX !== undefined) q.set('sandbox', process.env.OA_SPIKE_SANDBOX)
  if (process.env.OA_SPIKE_ALLOW !== undefined) q.set('allow', process.env.OA_SPIKE_ALLOW)
  return q.size ? `?${q}` : ''
}

type CapCall = { cap: string; method: string; args: unknown[] }
type Spike = { wants: string[]; calls: CapCall[]; chrome: string[]; published: Record<string, unknown>[] }

test('slides editor opens, shows slides and publishes an edit through the broker', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(`${r.resourceType()} ${r.url()}`))
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto(`${HOST_ORIGIN}/${frameQuery()}`)
  const frame = page.frameLocator('iframe[name="open-artifact-shell"]')

  await expect(frame.getByText('Slides QA · 浏览器回归').first()).toBeVisible({ timeout: 20_000 })
  await expect(frame.getByText('Heading').first()).toBeVisible()

  await frame.getByRole('main').getByText('Slides QA · 浏览器回归').dblclick()
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')
  await page.keyboard.press('Escape')

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { spike: Spike }).spike.published.length), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0)
  const spike = await page.evaluate(() => (window as unknown as { spike: Spike }).spike)
  const batch = spike.published[0] as Record<string, { content: string; ifMatch?: string | null }>
  const slide = batch['project/slides/s-aswqni.html']
  expect(slide?.content).toContain('edited')
  expect(slide?.ifMatch).toMatch(/^[0-9a-f]{64}$/)

  // A change made elsewhere arrives as cap_ev artifact/files and is merged live.
  await page.evaluate(() =>
    (window as unknown as { spikeRemote: (p: string, t: string) => Promise<void> }).spikeRemote(
      'project/slides/s-u7lxj2.html',
      '<section id="s-u7lxj2" data-flat style="display:flex;flex-direction:column;gap:48px;padding:128px">\n  <h2>Heading from the agent</h2>\n</section>\n',
    ),
  )
  await expect(frame.getByText('Heading from the agent').first()).toBeVisible({ timeout: 10_000 })

  const report = { wants: spike.wants, calls: spike.calls, chrome: spike.chrome, requests, errors }
  writeFileSync(test.info().outputPath('spike-report.json'), JSON.stringify(report, null, 2))
  if (process.env.OA_SPIKE_REPORT) writeFileSync(process.env.OA_SPIKE_REPORT, JSON.stringify(report, null, 2))
})

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

type Full = Spike & { downloads: { name: string; size: number; type: string }[] }

test('image upload, exports and present: the URLs and capabilities they use', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(`${r.resourceType()} ${r.url()}`))
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const popups: string[] = []
  page.on('popup', (p) => popups.push(p.url()))
  const spikeOf = () => page.evaluate(() => (window as unknown as { spike: Full }).spike)
  const command = (c: object) =>
    page.evaluate((c) => (window as unknown as { spikeCmd: (c: object) => void }).spikeCmd(c), c)

  await page.goto(`${HOST_ORIGIN}/${frameQuery()}`)
  const frame = page.frameLocator('iframe[name="open-artifact-shell"]')
  await expect(frame.getByRole('main').getByText('Slides QA · 浏览器回归')).toBeVisible({ timeout: 20_000 })

  await frame.getByRole('button', { name: 'Image or video' }).click()
  const chooser = page.waitForEvent('filechooser')
  await frame.getByRole('menuitem', { name: 'Image or video from this computer…' }).click()
  await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await expect.poll(async () => (await spikeOf()).calls.some((c) => c.cap === 'assets')).toBe(true)
  await expect(frame.getByRole('main').locator('img[src^="/_blob/"]').first()).toBeAttached({
    timeout: 10_000,
  })

  const exports: Record<string, string> = {}
  // pdf and html are `interactive`: the editor opens its own options dialog first.
  for (const [format, variant, interactive] of [
    ['png'],
    ['pptx', 'current'],
    ['pptx', 'pictures'],
    ['pdf', undefined, true],
    ['html', undefined, true],
  ] as const) {
    const request = `spike-${format}-${variant ?? 'all'}-0123456789abcdef`
    await command({ cmd: 'export_format', request, format, ...(variant ? { variant } : {}) })
    if (interactive)
      await frame
        .getByRole('dialog')
        .getByRole('button', { name: /^(Export|Download)/ })
        .click({ timeout: 5_000 })
        .catch(() => {})
    const settled = /"state":"(done|failed|declined|busy|unsupported)"/
    await expect
      .poll(async () => (await spikeOf()).chrome.some((c) => c.includes(request) && settled.test(c)), {
        timeout: 30_000,
      })
      .toBe(true)
      .catch(() => {})
    exports[`${format}:${variant ?? 'all'}`] =
      (await spikeOf()).chrome.filter((c) => c.includes(request)).join(' | ') || 'no answer'
  }

  await command({ cmd: 'action', id: 'present' })
  await page.waitForTimeout(1500)

  const spike = await spikeOf()
  const report = {
    exports,
    calls: spike.calls,
    chrome: spike.chrome,
    downloads: spike.downloads,
    requests,
    errors,
    popups,
  }
  writeFileSync(test.info().outputPath('spike-report-2.json'), JSON.stringify(report, null, 2))
  if (process.env.OA_SPIKE_REPORT)
    writeFileSync(`${process.env.OA_SPIKE_REPORT}.2.json`, JSON.stringify(report, null, 2))
  expect(Object.values(exports).every((e) => e.includes('"state":"done"'))).toBe(true)
  expect(spike.downloads.map((d) => d.name.split('.').at(-1))).toEqual(['png', 'pptx', 'pptx', 'pdf', 'html'])
  expect(errors.filter((e) => /policy|Content Security|Refused|sandbox/i.test(e))).toEqual([])
})
