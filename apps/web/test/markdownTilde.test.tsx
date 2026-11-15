import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/features/chat/Markdown'

// Chinese text uses a single ~ for ranges and "about" (9/29~9/30, 2~8s); only ~~double~~ strikes through.
describe('Markdown tildes', () => {
  it('keeps single tildes as text', () => {
    const { container } = render(<Markdown text="9/29~9/30 时同一指标一般是 2~8s，约 ~3s" />)
    expect(container.querySelector('del')).toBeNull()
    expect(container.textContent).toContain('9/29~9/30 时同一指标一般是 2~8s，约 ~3s')
  })

  it('still strikes through double tildes', () => {
    const { container } = render(<Markdown text="~~作废~~ 保留" />)
    expect(container.querySelector('del')?.textContent).toBe('作废')
  })
})
