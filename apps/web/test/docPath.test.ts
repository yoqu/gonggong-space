import { describe, expect, it } from 'vitest'
import { docPath } from '../src/features/files/docPath'

describe('docPath', () => {
  it('resolves relative and root paths from the file folder', () => {
    expect(docPath('docs/a.md', 'img/x.png')).toBe('docs/img/x.png')
    expect(docPath('docs/a.md', './x.png?raw=1#top')).toBe('docs/x.png')
    expect(docPath('docs/a.md', '../src/%E5%9B%BE.png')).toBe('src/图.png')
    expect(docPath('docs/a/b.md', '/README.md')).toBe('README.md')
    expect(docPath('a.md', 'sub/')).toBe('sub/')
  })

  it('leaves outside urls and in-page anchors alone', () => {
    for (const url of [
      'https://x.com/a',
      'mailto:a@b.c',
      '//cdn.x/a.png',
      'data:image/png;base64,AA',
      '#top',
      '',
    ])
      expect(docPath('docs/a.md', url)).toBeUndefined()
  })

  it('refuses paths that leave the workspace', () => {
    expect(docPath('docs/a.md', '../../etc/passwd')).toBeNull()
    expect(docPath('a.md', '..')).toBeNull()
    expect(docPath('a.md', '%2e%2e/x')).toBeNull()
    expect(docPath('a.md', '/')).toBeNull()
  })
})
