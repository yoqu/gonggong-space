import { describe, expect, it } from 'vitest'
import {
  defaultState,
  GgArtifactManifest,
  parseStateSet,
  parseStateWhen,
  screenDims,
  stateFromQuery,
  stateMatches,
  stateQuery,
} from '../src/index.js'

const role = {
  id: 'role',
  label: '角色',
  values: [
    { id: 'member', label: '会员' },
    { id: 'guest', label: '游客' },
  ],
}
const order = {
  id: 'order',
  label: '订单状态',
  values: [
    { id: 'unpaid', label: '待付款' },
    { id: 'refunded', label: '已退款' },
  ],
}
const manifest = (extra: object = {}, screen: object = {}) => ({
  title: '商城',
  device: 'mobile',
  entry: 'detail',
  screens: [
    {
      id: 'detail',
      title: '订单详情',
      file: 'screens/detail.html',
      uses: ['role'],
      dims: [order],
      ...screen,
    },
    { id: 'home', title: '首页', file: 'screens/home.html' },
  ],
  dims: [role],
  ...extra,
})

describe('state dimensions in gg-artifact.json', () => {
  it('keeps global dims, the global dims a screen uses and its own dims', () => {
    const m = GgArtifactManifest.parse(manifest())
    expect(m.dims).toEqual([role])
    expect(m.screens[0]?.uses).toEqual(['role'])
    expect(screenDims(m, 'detail').map((d) => d.id)).toEqual(['role', 'order'])
    expect(screenDims(m, 'home')).toEqual([])
    expect(screenDims(m, 'gone')).toEqual([])
  })

  it('rejects a used dim that is not global, a screen dim named like a global one and repeated values', () => {
    expect(GgArtifactManifest.safeParse(manifest({}, { uses: ['net'] })).success).toBe(false)
    expect(GgArtifactManifest.safeParse(manifest({}, { dims: [{ ...order, id: 'role' }] })).success).toBe(
      false,
    )
    expect(GgArtifactManifest.safeParse(manifest({ dims: [role, role] })).success).toBe(false)
    const twice = { ...order, values: [order.values[0], order.values[0]] }
    expect(GgArtifactManifest.safeParse(manifest({}, { dims: [twice] })).success).toBe(false)
    expect(
      GgArtifactManifest.safeParse(
        manifest({}, { dims: [order, { ...order, id: 'a' }, { ...order, id: 'b' }] }),
      ).success,
    ).toBe(false)
  })

  it('defaults to each dim’s first value and round-trips a query, dropping unknown dims and values', () => {
    const dims = [role, order]
    expect(defaultState(dims)).toEqual({ role: 'member', order: 'unpaid' })
    const q = stateQuery({ role: 'guest', order: 'refunded' })
    expect(q).toBe('role=guest&order=refunded')
    expect(stateFromQuery(dims, `?${q}&order=lost&x=1`)).toEqual({ role: 'guest', order: 'refunded' })
    expect(stateFromQuery(dims, 'order=lost')).toEqual({ role: 'member', order: 'unpaid' })
  })
})

describe('data-gg-when and data-gg-set', () => {
  it('parses conditions: spaces are and, | is or', () => {
    const when = parseStateWhen(' order=unpaid|refunded  role=member ')
    expect(when).toEqual([
      { dim: 'order', values: ['unpaid', 'refunded'] },
      { dim: 'role', values: ['member'] },
    ])
    expect(stateMatches(when ?? [], { order: 'refunded', role: 'member' })).toBe(true)
    expect(stateMatches(when ?? [], { order: 'refunded', role: 'guest' })).toBe(false)
    expect(stateMatches(when ?? [], { role: 'member' })).toBe(false)
  })

  it('refuses malformed text', () => {
    for (const bad of ['', 'order', 'order=', 'order!=paid', 'Order=paid', 'order=a||b'])
      expect(parseStateWhen(bad)).toBeNull()
    expect(parseStateSet('order=paid role=guest')).toEqual({ order: 'paid', role: 'guest' })
    expect(parseStateSet('order=paid|unpaid')).toBeNull()
    expect(parseStateSet('order=paid order=unpaid')).toBeNull()
  })
})
