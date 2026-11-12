import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// jsdom does not lay out, but it resolves the cascade of the real stylesheets: enough to pin the rules that broke
// the layout at 1280 wide (频道 folded into two lines, a DM's bot name cut short with room to spare).
const css = (path: string) => readFileSync(join(import.meta.dirname, '../src', path), 'utf8')

const mount = (html: string) => {
  const style = document.createElement('style')
  style.textContent = css('app/shell.css') + css('ui/im/conversation.css')
  document.head.append(style)
  document.body.innerHTML = html
}
afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('sidebar layout', () => {
  it('keeps a section head title on one line: its hover buttons stay icon-sized', () => {
    mount(`<div class="sidebar__sechead">
      <button class="sidebar__head sidebar__fold">频道</button>
      <button class="sidebar__add" id="add">+</button>
    </div>`)
    const add = getComputedStyle(document.getElementById('add')!)
    expect(add.width).not.toBe('100%')
    expect(add.flexShrink).toBe('0')
    expect(getComputedStyle(document.querySelector('.sidebar__fold')!).whiteSpace).toBe('nowrap')
  })

  it('lets a conversation name use the whole line when no tags sit beside it', () => {
    mount(`<span class="pn-conv__line" id="bare"><span class="pn-conv__name">李晓的 Claude Code</span><span class="pn-conv__time"></span></span>
      <span class="pn-conv__line" id="tagged"><span class="pn-conv__name">发版群</span><span class="ui-tag">Bot</span><span class="pn-conv__time"></span></span>`)
    const name = (id: string) => getComputedStyle(document.querySelector(`#${id} .pn-conv__name`)!)
    expect(name('bare').maxWidth).toBe('none')
    expect(name('tagged').maxWidth).toBe('55%')
  })
})
