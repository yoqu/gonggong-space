import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DiffView } from '../src/features/diff/DiffParts'
import { CodeBlock, highlight, langFor, langOf } from '../src/ui'

const colored = (el: Element) => [...el.querySelectorAll<HTMLElement>('.hl')]

describe('syntax highlighting', () => {
  it('maps file names and fence aliases to grammars', () => {
    expect(langOf('src/main.ts')).toBe('typescript')
    expect(langOf('App.TSX')).toBe('tsx')
    expect(langOf('deploy/Dockerfile')).toBe('dockerfile')
    expect(langOf('run.sh')).toBe('shellscript')
    expect(langOf('notes.txt')).toBeNull()
    expect(langOf('Makefile.unknown')).toBeNull()
    expect(langFor('bash')).toBe('shellscript')
    expect(langFor('TS')).toBe('typescript')
    expect(langFor('yml')).toBe('yaml')
    expect(langFor('nope')).toBeNull()
    expect(langFor(undefined)).toBeNull()
  })

  it('colours tokens with the GitHub light and dark themes', async () => {
    const lines = await highlight('const a = 1\nlet b', 'typescript')
    expect(lines).toHaveLength(2)
    const kw = lines[0]?.find((t) => t.content === 'const')
    expect(kw).toMatchObject({ light: '#D73A49', dark: '#F97583' })
  })

  it('colours fenced code by its language and leaves unknown languages plain', async () => {
    const { container, rerender } = render(<CodeBlock code="const a = 1" language="ts" />)
    await waitFor(() => expect(colored(container).length).toBeGreaterThan(0))
    const kw = colored(container).find((s) => s.textContent === 'const') as HTMLElement
    expect(kw.style.getPropertyValue('--hl-l')).toBe('#D73A49')
    expect(kw.style.getPropertyValue('--hl-d')).toBe('#F97583')
    expect(container.querySelector('pre')?.textContent).toBe('const a = 1')
    rerender(<CodeBlock code="plain words" language="nope" />)
    expect(colored(container)).toHaveLength(0)
  })

  it('colours diff lines by the file language, keeping the +/- marks and line tints', async () => {
    const file = {
      path: 'src/a.ts',
      status: 'modified' as const,
      add: 1,
      del: 1,
      binary: false,
      lines: ['@@ -1 +1 @@', '-const a = 1', '+const a = 2', ' export { a }'],
    }
    const { container } = render(<DiffView file={file} />)
    await waitFor(() => expect(colored(container).length).toBeGreaterThan(0))
    const rows = [...container.querySelectorAll<HTMLElement>('.diff__line')]
    expect(rows.map((r) => r.textContent)).toEqual(file.lines)
    expect(rows[0]?.querySelector('.hl')).toBeNull()
    expect(rows[2]?.className).toContain('diff__line--add')
    expect(rows[2]?.querySelector('.hl')?.textContent).toBe('const')
  })
})
