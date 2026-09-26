import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { kindOf } from '../src/features/attachments/api'
import { DropZone, FileAttachment, FileIcon, fileType } from '../src/ui'

describe('fileType', () => {
  it.each([
    ['报告.PDF', '', 'pdf'],
    ['a.docx', '', 'word'],
    ['a.doc', '', 'word'],
    ['a.xlsx', '', 'excel'],
    ['a.csv', 'text/csv', 'excel'],
    ['a.pptx', '', 'ppt'],
    ['a.tar.gz', '', 'archive'],
    ['a.7z', '', 'archive'],
    ['a.mp3', '', 'audio'],
    ['voice', 'audio/ogg', 'audio'],
    ['README.md', '', 'md'],
    ['notes', 'text/markdown', 'md'],
    ['ci.log', '', 'text'],
    ['plain', 'text/plain', 'text'],
    ['main.rs', '', 'code'],
    ['page.html', 'text/html', 'code'],
    ['shot.png', '', 'image'],
    ['logo.svg', 'image/svg+xml', 'image'],
    ['clip', 'video/mp4', 'video'],
    ['dump.bin', 'application/octet-stream', 'other'],
    ['Makefile', '', 'other'],
  ])('%s (%s) → %s', (name, mime, type) => {
    expect(fileType(name, mime)).toBe(type)
  })
})

describe('kindOf keeps preview kinds', () => {
  it.each([
    ['shot.png', 'image/png', 'image'],
    ['logo.svg', 'image/svg+xml', 'file'],
    ['clip.mp4', 'video/mp4', 'video'],
    ['spec.md', 'text/markdown', 'md'],
    ['page.html', 'text/html', 'code'],
    ['ci.log', 'text/plain', 'text'],
    ['data.csv', 'text/csv', 'text'],
    ['report.pdf', 'application/pdf', 'file'],
  ])('%s → %s', (name, mime, kind) => {
    expect(kindOf({ name, mime })).toBe(kind)
  })
})

describe('FileIcon', () => {
  it('draws a tinted document with the type label', () => {
    const { container } = render(<FileIcon name="报告.pdf" size={32} />)
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.dataset.type).toBe('pdf')
    expect(svg.getAttribute('width')).toBe('32')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('style')).toContain('var(--system-red)')
    expect(svg.textContent).toBe('PDF')
  })

  it('uses a glyph for media and code, and drops text labels when tiny', () => {
    const code = render(<FileIcon name="main.ts" size={32} />).container.querySelector('svg')
    expect(code?.textContent).toBe('')
    expect(code?.querySelectorAll('path').length).toBeGreaterThan(1)
    const tiny = render(<FileIcon name="a.docx" size={14} />).container.querySelector('svg')
    expect(tiny?.dataset.type).toBe('word')
    expect(tiny?.textContent).toBe('')
  })

  it('is used by FileAttachment and DropZone', () => {
    const card = render(<FileAttachment name="客户名单.xlsx" size="820 KB" />).container
    expect(card.querySelector('svg[data-type="excel"]')).toBeTruthy()
    const drop = render(<DropZone files={[{ name: 'a.zip' }]} />).container
    expect(drop.querySelector('svg[data-type="archive"]')).toBeTruthy()
  })
})
