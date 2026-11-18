import { GgArtifactManifest } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useScreenStates } from '../src/features/artifacts/screenStates'

const manifest = GgArtifactManifest.parse({
  title: '商城',
  device: 'mobile',
  entry: 'list',
  dims: [
    {
      id: 'role',
      label: '角色',
      values: [
        { id: 'member', label: '会员' },
        { id: 'guest', label: '游客' },
      ],
    },
  ],
  screens: [
    { id: 'list', title: '订单列表', file: 'screens/list.html', uses: ['role'] },
    {
      id: 'detail',
      title: '订单详情',
      file: 'screens/detail.html',
      uses: ['role'],
      dims: [
        {
          id: 'order',
          label: '订单状态',
          values: [
            { id: 'unpaid', label: '待付款' },
            { id: 'refunded', label: '已退款' },
          ],
        },
      ],
    },
    { id: 'about', title: '关于', file: 'screens/about.html' },
  ],
})

function Harness() {
  const states = useScreenStates(manifest)
  return (
    <>
      {manifest.screens.map((s) => (
        <div key={s.id}>
          {states.picker(s.id)}
          <output data-testid={`src-${s.id}`}>{states.fileOf(s)}</output>
        </div>
      ))}
      <button type="button" onClick={() => states.choose('detail', { order: 'refunded' })}>
        link
      </button>
    </>
  )
}

const pick = (screenId: string, item: string) => {
  fireEvent.click(screen.getByTestId(`art-state-${screenId}`))
  fireEvent.click(screen.getByRole('menuitemradio', { name: item }))
}

describe('screen states on the canvas', () => {
  it('loads every screen with dims in its default state, and offers no picker to a screen without', () => {
    render(<Harness />)
    expect(screen.getByTestId('src-list').textContent).toBe('screens/list.html?role=member')
    expect(screen.getByTestId('src-detail').textContent).toBe('screens/detail.html?role=member&order=unpaid')
    expect(screen.getByTestId('src-about').textContent).toBe('screens/about.html')
    expect(screen.queryByTestId('art-state-about')).toBeNull()
    expect(screen.getByTestId('art-state-detail').textContent).toBe('默认状态')
  })

  it('a global choice holds on every screen using it, a screen’s own only there; a link sets its target’s', () => {
    render(<Harness />)
    pick('list', '游客')
    expect(screen.getByTestId('src-detail').textContent).toBe('screens/detail.html?role=guest&order=unpaid')
    pick('detail', '已退款')
    expect(screen.getByTestId('art-state-detail').textContent).toBe('游客 · 已退款')
    expect(screen.getByTestId('src-list').textContent).toBe('screens/list.html?role=guest')
    pick('detail', '待付款')
    fireEvent.click(screen.getByText('link'))
    expect(screen.getByTestId('src-detail').textContent).toBe('screens/detail.html?role=guest&order=refunded')
  })
})
