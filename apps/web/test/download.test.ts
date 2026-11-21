import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob, downloadUrl } from '../src/lib/download'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('download', () => {
  it('clicks an attached link named after the file', () => {
    const seen: [string | null, string, boolean][] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      seen.push([this.getAttribute('href'), this.download, this.isConnected])
    })
    downloadUrl('/api/x.zip')
    downloadUrl('/files/a.png', 'a.png')
    expect(seen).toEqual([
      ['/api/x.zip', '', true],
      ['/files/a.png', 'a.png', true],
    ])
    expect(document.querySelector('a')).toBeNull()
  })

  it('revokes the blob URL only after the download has started', () => {
    vi.useFakeTimers()
    const revoke = vi.fn()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadBlob('home.html', new Blob(['<h1>首页</h1>'], { type: 'text/html' }))
    expect(click).toHaveBeenCalledOnce()
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})
