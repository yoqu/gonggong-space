import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GgArtifactManifest } from '@gonggong/protocol'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { lintVersion } from '../src/modules/artifacts/lint.js'
import { lintStates } from '../src/modules/artifacts/states.js'

const KIT = join(import.meta.dirname, '../plugins/official/web-prototype/skills/web-prototype/kit')
const GG_KIT = readFileSync(join(KIT, 'gg-kit.js'), 'utf8')

const role = {
  id: 'role',
  label: '角色',
  values: [
    { id: 'member', label: '会员' },
    { id: 'guest', label: '游客' },
  ],
}
const order = {
  id: 'order',
  label: '订单状态',
  values: [
    { id: 'unpaid', label: '待付款' },
    { id: 'refunded', label: '已退款' },
  ],
}
const MANIFEST = {
  title: '商城',
  device: 'mobile',
  entry: 'list',
  dims: [role],
  screens: [
    { id: 'list', title: '订单列表', file: 'screens/list.html' },
    { id: 'detail', title: '订单详情', file: 'screens/detail.html', uses: ['role'], dims: [order] },
  ],
}

const PAGE = `<!doctype html><html><head></head><body>
<p id="pay" data-gg-when="order=unpaid role=member">去支付</p>
<p id="refund" data-gg-when="order=refunded">退款进度</p>
<p id="any" data-gg-when="order=unpaid|refunded">订单号</p>
<p id="bad" data-gg-when="order!=unpaid">写错的条件</p>
<button id="sw" data-gg-set="order=refunded">模拟退款</button>
<a id="go" data-gg-link="list" data-gg-set="role=guest">切到游客看列表</a>
<script>${GG_KIT}</script>
</body></html>`

/** A screen inside the shell (or on its own), its manifest read from the server when its query leaves a dim out. */
function screen(query: string, framed = true) {
  const top = new JSDOM('<!doctype html><body></body>', { url: 'https://p.test/' })
  const posts: Record<string, unknown>[] = []
  Object.defineProperty(top.window, 'postMessage', { value: (d: Record<string, unknown>) => posts.push(d) })
  let reads = 0
  const dom = new JSDOM(PAGE, {
    url: `https://p.test/screens/detail.html${query}`,
    runScripts: 'dangerously',
    beforeParse(win) {
      if (framed) Object.defineProperty(win, 'parent', { value: top.window, configurable: true })
      win.XMLHttpRequest = class {
        responseText = ''
        open(_m: string, url: string) {
          reads++
          expect(url).toBe('../gg-artifact.json')
        }
        send() {
          this.responseText = JSON.stringify(MANIFEST)
        }
      } as never
    },
  })
  const w = dom.window
  const off = () =>
    [...w.document.querySelectorAll('[data-gg-when]')]
      .filter((e) => e.hasAttribute('data-gg-off'))
      .map((e) => e.id)
  const click = (id: string) =>
    w.document
      .getElementById(id)
      ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
  return { w, posts, off, click, reads: () => reads }
}

describe('gg-kit screen states', () => {
  it('shows what the query’s state calls for; a malformed condition always shows', () => {
    const s = screen('?role=member&order=refunded')
    expect(s.off()).toEqual(['pay'])
    expect(s.reads()).toBe(0)
    expect(getComputedStyleDisplay(s.w, 'pay')).toBe('none')
  })

  it('takes the dims the query leaves out from gg-artifact.json, first value first', () => {
    const s = screen('')
    expect(s.off()).toEqual(['refund'])
    expect(s.reads()).toBe(1)
  })

  it('data-gg-set switches in place and tells the shell; with a link the shell gets the state to go with', () => {
    const s = screen('?role=member&order=unpaid')
    s.click('sw')
    expect(s.off()).toEqual(['pay'])
    expect(s.w.location.search).toBe('?role=member&order=refunded')
    expect(s.posts.at(-1)).toEqual({ type: 'gg:state', state: { order: 'refunded' } })
    s.click('go')
    expect(s.posts.at(-1)).toEqual({
      type: 'gg:nav',
      screen: 'list',
      transition: null,
      set: { role: 'guest' },
    })
  })
})

const getComputedStyleDisplay = (w: JSDOM['window'], id: string) =>
  w.getComputedStyle(w.document.getElementById(id) as Element).display

function openShell(hash: string) {
  const shell = readFileSync(join(KIT, 'index.html'), 'utf8').replace(
    '<script>',
    `<script type="application/json" id="gg-manifest">${JSON.stringify(MANIFEST)}</script><script>`,
  )
  const { window: w } = new JSDOM(shell, {
    url: `https://p.test/${hash}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.matchMedia = (() => ({ matches: false, addEventListener() {} })) as never
    },
  })
  const $ = (sel: string) => w.document.querySelector(sel) as HTMLElement
  const src = () => $('.stage iframe').getAttribute('src')
  const selects = () =>
    [...w.document.querySelectorAll<HTMLSelectElement>('.dims select')].map((s) => [
      s.previousElementSibling?.textContent,
      s.value,
    ])
  const message = (data: object) =>
    w.dispatchEvent(
      new w.MessageEvent('message', {
        data,
        origin: 'https://p.test',
        source: (w.document.querySelector('.stage iframe') as HTMLIFrameElement).contentWindow,
      }),
    )
  return { w, $, src, selects, message }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('shell screen states', () => {
  it('opens a shared #play:<id>?<state> in that state and offers the screen’s dims only', async () => {
    const s = openShell('#play:detail?order=refunded&x=1')
    await tick()
    expect(s.src()).toBe('screens/detail.html?role=member&order=refunded')
    expect(s.selects()).toEqual([
      ['角色', 'member'],
      ['订单状态', 'refunded'],
    ])
    expect(s.w.location.hash).toBe('#play:detail?role=member&order=refunded')
  })

  it('a screen without dims plays as before', async () => {
    const s = openShell('#play:list')
    await tick()
    expect(s.src()).toBe('screens/list.html')
    expect(s.selects()).toEqual([])
    expect(s.w.location.hash).toBe('#play:list')
  })

  it('switching a dim reloads the screen; a global choice holds on the next screen, a link carries its state', async () => {
    const s = openShell('#play:detail')
    await tick()
    const select = s.$('.dims select') as HTMLSelectElement
    select.value = 'guest'
    select.dispatchEvent(new s.w.Event('change'))
    expect(s.src()).toBe('screens/detail.html?role=guest&order=unpaid')
    s.message({ type: 'gg:state', state: { order: 'refunded' } })
    expect(s.w.location.hash).toBe('#play:detail?role=guest&order=refunded')
    s.message({ type: 'gg:nav', screen: 'list', transition: 'none', set: {} })
    expect(s.w.location.hash).toBe('#play:list')
    s.message({ type: 'gg:nav', screen: 'detail', transition: 'none', set: { role: 'member' } })
    expect(s.src()).toBe('screens/detail.html?role=member&order=refunded')
  })
})

describe('shell overview screen states', () => {
  const chips = (w: JSDOM['window'], i: number) =>
    [...(w.document.querySelectorAll('.frame')[i]?.querySelectorAll('.label select') ?? [])].map((el) => {
      const s = el as HTMLSelectElement
      return [s.title, s.value]
    })

  it('marks a screen with states by its dims, opens #canvas?<state> in that state, a screen’s own dims as <screen>.<dim>', async () => {
    const s = openShell('#canvas?role=guest&detail.order=refunded')
    await tick()
    expect(chips(s.w, 0)).toEqual([])
    expect(chips(s.w, 1)).toEqual([
      ['角色：会员 / 游客', 'guest'],
      ['订单状态：待付款 / 已退款', 'refunded'],
    ])
    expect(s.w.location.hash).toBe('#canvas?role=guest&detail.order=refunded')
  })

  it('switches a screen in place, and the address follows', async () => {
    const s = openShell('#canvas')
    await tick()
    expect(s.w.location.hash).toBe('#canvas')
    const select = s.w.document
      .querySelectorAll('.frame')[1]
      ?.querySelectorAll('.label select')[1] as HTMLSelectElement
    select.value = 'refunded'
    select.dispatchEvent(new s.w.Event('change'))
    expect(s.w.location.hash).toBe('#canvas?detail.order=refunded')
    expect(s.$('[data-view="canvas"]').getAttribute('aria-pressed')).toBe('true')
    // 预览 of that screen plays it in the state chosen here.
    ;(s.w.document.querySelectorAll('.label button')[1] as HTMLButtonElement).click()
    expect(s.src()).toBe('screens/detail.html?role=member&order=refunded')
  })
})

describe('lint of screen states', () => {
  const manifest = GgArtifactManifest.parse(MANIFEST)
  it('names malformed conditions, dims or values the screen does not have, and dims it never uses', () => {
    const html = `<p data-gg-when="order=unpaid role=member">a</p>
<p data-gg-when="order!=paid">b</p>
<p data-gg-when="order=lost">c</p>
<p data-gg-when="net=off">d</p>
<a data-gg-link="list" data-gg-set="order=refunded">e</a>
<button data-gg-set="order=refunded">f</button>`
    expect(lintStates(manifest, 'screens/detail.html', html).map((i) => [i.code, i.message])).toEqual([
      ['state-invalid', '状态条件写法不对：order!=paid'],
      ['state-unknown', '状态取值不存在：order=lost'],
      ['state-unknown', '本屏没有状态维度：net'],
      ['state-unknown', '屏幕 list 没有状态维度：order'],
    ])
    expect(lintStates(manifest, 'screens/detail.html', '<p data-gg-when="order=unpaid">a</p>')).toEqual([
      expect.objectContaining({ code: 'state-unused', message: '声明了却没用到的状态维度：role' }),
    ])
    expect(lintStates(manifest, 'screens/list.html', '<p>a</p>')).toEqual([])
  })
  it('runs with the version lint', async () => {
    const files: Record<string, string> = {
      'gg-artifact.json': JSON.stringify(MANIFEST),
      'screens/list.html': '<p>列表</p>',
      'screens/detail.html': '<p data-gg-when="order=lost role=member">a</p>',
    }
    const list = Object.keys(files).map((path) => ({ path, hash: 'a'.repeat(64), size: 1 }))
    const issues = await lintVersion(list, async (f) => Buffer.from(files[f.path] ?? ''), null)
    expect(issues.filter((i) => i.code.startsWith('state-')).map((i) => i.message)).toEqual([
      '状态取值不存在：order=lost',
    ])
  })
})
