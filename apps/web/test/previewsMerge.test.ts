import { describe, expect, it } from 'vitest'
import { mergePreviewsAndServices, previewTechInfo } from '../src/features/previews/merge'

describe('mergePreviewsAndServices', () => {
  const previews = [
    { id: 'p1', kind: 'http', title: 'Web', path: '/app', port: 5173, serviceId: 'sv1', serviceName: 'web' },
    {
      id: 'p2',
      kind: 'static',
      title: 'Docs',
      path: '/',
      port: null,
      serviceId: 'sv2',
      serviceName: 'docs',
    },
    { id: 'p3', kind: 'http', title: 'External', path: '/', port: 8080, serviceId: null, serviceName: null },
  ]
  const services = [
    { id: 'sv1', name: 'web', port: 5173, command: 'pnpm dev' },
    { id: 'sv2', name: 'docs', port: null, command: 'pnpm docs' },
    { id: 'sv3', name: 'worker', port: null, command: 'python worker.py' },
  ]

  it('attaches bound services to previews and leaves only unbound services as backgroundServices', () => {
    const res = mergePreviewsAndServices(previews, services)
    expect(res.items.map((x) => [x.preview.id, x.service?.id ?? null])).toEqual([
      ['p1', 'sv1'],
      ['p2', 'sv2'],
      ['p3', null],
    ])
    expect(res.backgroundServices.map((s) => s.id)).toEqual(['sv3'])
  })
})

describe('previewTechInfo', () => {
  it('returns null when no technical metadata is available', () => {
    expect(previewTechInfo({ port: null, path: '/', serviceName: null }, null)).toBeNull()
  })

  it('extracts port, non-root path, service name, and command', () => {
    expect(
      previewTechInfo(
        { port: null, path: '/report.html', serviceName: 'static-out' },
        { name: 'static-out', port: 50249, command: '静态站点 out' },
      ),
    ).toEqual({
      port: 50249,
      path: '/report.html',
      serviceName: 'static-out',
      command: '静态站点 out',
    })
  })
})
