import { describe, expect, it } from 'vitest'
import { previewConfig } from '../src/modules/previews/config.js'

describe('previewConfig', () => {
  it('defaults to port mode on the main listener host', () => {
    expect(previewConfig({})).toEqual({
      domain: null,
      ports: [41000, 41099],
      publicUrl: null,
      listenHost: '127.0.0.1',
    })
    expect(previewConfig({ HOST: '0.0.0.0' }).listenHost).toBe('0.0.0.0')
  })

  it('reads the domain, port range, public URL and a preview-only listen host', () => {
    const c = previewConfig({
      GONGGONG_PREVIEW_DOMAIN: '.example-preview.com',
      GONGGONG_PREVIEW_PORTS: '42000-42009',
      GONGGONG_PUBLIC_URL: 'https://gg.example.com/',
      GONGGONG_PREVIEW_HOST: '0.0.0.0',
    })
    expect(c).toEqual({
      domain: 'example-preview.com',
      ports: [42000, 42009],
      publicUrl: 'https://gg.example.com',
      listenHost: '0.0.0.0',
    })
  })

  it('rejects a malformed port range', () => {
    expect(() => previewConfig({ GONGGONG_PREVIEW_PORTS: '42009-42000' })).toThrow()
    expect(() => previewConfig({ GONGGONG_PREVIEW_PORTS: 'abc' })).toThrow()
  })
})
