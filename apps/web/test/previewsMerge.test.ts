import { describe, expect, it } from 'vitest'
import { mergePreviewsAndServices, previewTechInfo } from '../src/features/previews/merge'

describe('mergePreviewsAndServices', () => {
  const previews = [
    { id: 'p1', kind: 'http', title: 'Web', path: '/app', port: 5173, serviceId: 'sv1', serviceName: 'web' },
    {
      id: 'p2',
      kind: 'gui',
      title: 'Desktop',
      path: '/',
      port: null,
      serviceId: 'sv2',
      serviceName: 'gui-app',
    },
    { id: 'p3', kind: 'http', title: 'External', path: '/', port: 8080, serviceId: null, serviceName: null },
  ]
  const services = [
    { id: 'sv1', name: 'web', port: 5173, command: 'pnpm dev' },
    { id: 'sv2', name: 'gui-app', port: null, command: 'electron .' },
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

  it('still treats services bound to filtered-out live previews as bound (not orphaned)', () => {
    const res = mergePreviewsAndServices(previews, services, (p) => p.kind !== 'gui')
    expect(res.items.map((x) => x.preview.id)).toEqual(['p1', 'p3'])
    expect(res.backgroundServices.map((s) => s.id)).toEqual(['sv3'])
  })
})

describe('previewTechInfo', () => {
  it('returns null when no technical metadata is available', () => {
    expect(
      previewTechInfo({ kind: 'miniprogram', port: null, path: '/', serviceName: null }, null),
    ).toBeNull()
  })

  it('extracts port, non-root path, service name, and command', () => {
    expect(
      previewTechInfo(
        { kind: 'static', port: null, path: '/report.html', serviceName: 'static-out' },
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
