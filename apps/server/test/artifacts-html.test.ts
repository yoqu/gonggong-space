import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/lib/errors.js'
import {
  editHtml,
  editToken,
  elementsOf,
  injectBridge,
  lineOf,
  linksOf,
} from '../src/modules/artifacts/html.js'

const at = (html: string, needle: string) => String(html.indexOf(needle))
const refused = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError)
    return (e as HttpError).message
  }
  throw new Error('not refused')
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<body>
  <section data-section="hero">
    <h1 class="title" style="color: var(--color-primary); margin: 0">报名  活动</h1>
    <p>说明 <b>重点</b></p>
    <img src="a.png" alt="封面" />
    <a data-gg-link="done" href="#">去报名</a>
  </section>
</body>
</html>
`

describe('element ids', () => {
  it('are the start offsets of the tags in the source; implied elements have none', () => {
    const els = elementsOf('<p>a</p><div><span>b</span></div>')
    expect([...els.keys()]).toEqual([0, 8, 13])
    expect(els.get(13)?.tagName).toBe('span')
  })

  it('reach into templates and keep the stored source otherwise unchanged', () => {
    const html = '<template><i>x</i></template>'
    expect([...elementsOf(html).keys()]).toEqual([0, 10])
    const out = injectBridge(html, 'https://gg.test')
    expect(out).toBe(
      '<template data-gg-id="0"><i data-gg-id="10">x</i></template><script src="/__gg/bridge.js" data-gg-parent="https://gg.test"></script>',
    )
  })

  it('escape the parent origin and put the bridge before </body>', () => {
    const out = injectBridge('<body><p>x</p></body>', 'https://a.test"><script>')
    expect(out).toBe(
      '<body data-gg-id="0"><p data-gg-id="6">x</p><script src="/__gg/bridge.js" data-gg-parent="https://a.test&quot;><script>"></script></body>',
    )
  })

  it('lists screen links with their element and text', () => {
    expect(linksOf(PAGE)).toEqual([{ to: 'done', ggId: at(PAGE, '<a '), text: '去报名' }])
  })

  it('line numbers count from one', () => {
    expect(lineOf(PAGE, Number(at(PAGE, '<h1')))).toBe(5)
  })
})

describe('source edits', () => {
  const h1 = at(PAGE, '<h1')
  const img = at(PAGE, '<img')
  const p = at(PAGE, '<p>')
  const a = at(PAGE, '<a ')

  it('splices several elements from the end back and keeps the formatting around them', () => {
    const out = editHtml(PAGE, [
      { ggId: h1, kind: 'text', text: '立即 <报名> & 抽奖' },
      { ggId: img, kind: 'attr', name: 'alt', value: '新封面"' },
      { ggId: a, kind: 'attr', name: 'data-gg-link', value: 'home' },
    ])
    expect(out).toBe(
      PAGE.replace('>报名  活动<', '>立即 &lt;报名&gt; &amp; 抽奖<')
        .replace('alt="封面"', 'alt="新封面&quot;"')
        .replace('data-gg-link="done"', 'data-gg-link="home"'),
    )
  })

  it('merges the ops of one element into one change of its tag', () => {
    const out = editHtml(PAGE, [
      { ggId: h1, kind: 'style', props: { 'font-size': '20px', color: '' } },
      { ggId: h1, kind: 'attr', name: 'alt', value: 'x' },
      { ggId: h1, kind: 'style', props: { 'font-weight': 'bold' } },
      { ggId: h1, kind: 'text', text: '新标题' },
    ])
    expect(out).toBe(
      PAGE.replace(
        '<h1 class="title" style="color: var(--color-primary); margin: 0">报名  活动</h1>',
        '<h1 class="title" style="margin: 0; font-size: 20px; font-weight: bold" alt="x">新标题</h1>',
      ),
    )
  })

  it('removes an attribute, and the style attribute once it is empty', () => {
    const out = editHtml(PAGE, [
      { ggId: img, kind: 'attr', name: 'alt', value: null },
      { ggId: h1, kind: 'style', props: { color: '', margin: '' } },
    ])
    expect(out).toBe(
      PAGE.replace('<img src="a.png" alt="封面" />', '<img src="a.png" />').replace(
        ' style="color: var(--color-primary); margin: 0"',
        '',
      ),
    )
  })

  it("keeps semicolons inside a value's parentheses or quotes", () => {
    const html = '<div style="background: url(data:image/png;base64,AA); color: red">x</div>'
    expect(editHtml(html, [{ ggId: '0', kind: 'style', props: { color: 'var(--c)' } }])).toBe(
      '<div style="background: url(data:image/png;base64,AA); color: var(--c)">x</div>',
    )
  })

  it('deletes whole elements, void ones included', () => {
    const out = editHtml(PAGE, [
      { ggId: img, kind: 'delete' },
      { ggId: p, kind: 'delete' },
    ])
    expect(out).toBe(
      PAGE.replace('<p>说明 <b>重点</b></p>', '').replace('<img src="a.png" alt="封面" />', ''),
    )
  })

  it('edits the one text run beside icon-only children and keeps the icons and the whitespace', () => {
    const html = '<div>\n  <svg class="i"><use href="#i-shower"/></svg>热水淋浴\n</div>'
    expect(editHtml(html, [{ ggId: '0', kind: 'text', text: '冷热 & 淋浴' }])).toBe(
      '<div>\n  <svg class="i"><use href="#i-shower"/></svg>冷热 &amp; 淋浴\n</div>',
    )
    const icon = '<p>价格<i></i><br>¥268</p>'
    expect(refused(() => editHtml(icon, [{ ggId: '0', kind: 'text', text: 'x' }]))).toContain('子元素')
  })

  it('refuses text edits of elements with children, unknown ids and overlapping ranges', () => {
    expect(refused(() => editHtml(PAGE, [{ ggId: p, kind: 'text', text: 'x' }]))).toContain('子元素')
    expect(refused(() => editHtml(PAGE, [{ ggId: '3', kind: 'text', text: 'x' }]))).toContain('找不到')
    const section = at(PAGE, '<section')
    expect(
      refused(() =>
        editHtml(PAGE, [
          { ggId: section, kind: 'delete' },
          { ggId: h1, kind: 'text', text: 'x' },
        ]),
      ),
    ).toContain('重叠')
    expect(
      refused(() =>
        editHtml(PAGE, [
          { ggId: h1, kind: 'delete' },
          { ggId: h1, kind: 'text', text: 'x' },
        ]),
      ),
    ).toContain('既删除又修改')
  })

  it('refuses elements that load or run code, the page skeleton and implicitly closed elements', () => {
    const html = '<body><script src="a.js"></script><p>one<p>two</body>'
    expect(
      refused(() =>
        editHtml(html, [{ ggId: at(html, '<script'), kind: 'attr', name: 'src', value: 'b.js' }]),
      ),
    ).toContain('<script>')
    expect(refused(() => editHtml(html, [{ ggId: '0', kind: 'delete' }]))).toContain('骨架')
    expect(refused(() => editHtml(html, [{ ggId: at(html, '<p>one'), kind: 'text', text: 'x' }]))).toContain(
      '结束标签',
    )
  })
})

describe('tokens', () => {
  const css = ':root {\n  --color-primary: #155332;\n  --rounded-md: 8px\n}\n.x { --color-primary: red; }\n'
  it('sets an existing variable under :root only', () => {
    expect(editToken(css, '--color-primary', '#0071e3')).toBe(css.replace('#155332', '#0071e3'))
    expect(editToken(css, '--rounded-md', '12px')).toBe(css.replace('8px', '12px'))
    expect(editToken(css, '--color-x', '#000')).toBeNull()
    expect(editToken(css, '--color', '#000')).toBeNull()
  })
})
