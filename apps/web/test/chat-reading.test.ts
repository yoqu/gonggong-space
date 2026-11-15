import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(`src/${p}`, 'utf8')
const ruleOf = (css: string, selector: string) => {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('group chat reading details', () => {
  const message = read('ui/im/message.css')
  const composer = read('ui/im/composer.css')

  it('sets message text at 14px on a 22px line, prose capped at 720px', () => {
    const bubble = ruleOf(message, '.pn-bubble')
    expect(bubble).toContain('font-size: 14px;')
    expect(bubble).toContain('line-height: 22px;')
    expect(ruleOf(message, '.pn-bubble .md > :is(p, ul, ol, blockquote, h1, h2, h3, h4)')).toContain(
      'max-width: 720px;',
    )
    expect(message).toMatch(/\.pn-bubble > p,\s*\.pn-bubble \.md > :is/)
  })

  it('keeps Markdown headings semibold and never smaller than the text', () => {
    const chat = read('features/chat/chat.css')
    expect(chat).toMatch(/\.md h1,\s*\.md h2,\s*\.md h3,\s*\.md h4 \{[^}]*font-weight: 600;/)
    expect(chat).toMatch(/\.md h3,\s*\.md h4 \{\s*font-size: inherit;/)
  })

  it('shows the hover timestamp and composer placeholder in readable greys', () => {
    expect(ruleOf(message, '.pn-msg__stamp')).toContain('color: var(--label-secondary);')
    expect(ruleOf(composer, '.pn-composer textarea::placeholder')).not.toContain('--label-tertiary')
  })

  it('marks the current conversation with a heavier fill than hover', () => {
    const conv = read('ui/im/conversation.css')
    expect(ruleOf(conv, '.pn-conv:hover')).toContain('var(--selection-fill)')
    expect(ruleOf(conv, '.pn-conv[aria-current]')).toContain('background: var(--selection-inactive);')
    const capsule = ruleOf(read('app/shell.css'), '.sidebar__scroll::before')
    expect(capsule).toContain('background: var(--selection-inactive);')
    expect(capsule).not.toContain('box-shadow')
  })

  it('deepens the composer stroke on focus and saves the blue glow for drops', () => {
    const focus = ruleOf(composer, '.pn-composer:focus-within')
    expect(focus).not.toContain('--accent')
    expect(focus).not.toContain('--tint-blue')
    expect(ruleOf(composer, '.pn-composer--drop')).toContain('0 0 0 3px var(--tint-blue)')
  })
})
