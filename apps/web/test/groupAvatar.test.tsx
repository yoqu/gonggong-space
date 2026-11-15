import type { BotDto } from '@gonggong/protocol'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { avatarSrc } from '../src/features/bots/avatars'
import { GroupAvatar } from '../src/features/groups/GroupAvatar'

const bot = {
  id: 'b1',
  name: '小王的 Claude',
  agentKind: 'claude',
  avatar: 'role-spring',
  presence: 'online',
} as BotDto
const members = [
  { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
  { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
]

afterEach(() => useWorkspace.setState({ bots: [] }))

describe('GroupAvatar', () => {
  it('tiles people then bots, bots with their SVG art', () => {
    useWorkspace.setState({ bots: [bot] })
    const { container } = render(
      <GroupAvatar
        group={{ name: '支付服务重构', kind: 'group', avatar: null, members, botIds: ['b1', 'gone'] }}
        size={40}
      />,
    )
    const tiles = [...container.querySelectorAll('.ui-avatar__tile')]
    expect(tiles.map((t) => t.textContent)).toEqual(['磊', '国', ''])
    expect(tiles[2]?.querySelector('image')?.getAttribute('href')).toBe(avatarSrc('role-spring'))
  })

  it('a DM shows its bot avatar', () => {
    useWorkspace.setState({ bots: [bot] })
    const { container } = render(
      <GroupAvatar
        group={{ name: '小王的 Claude', kind: 'dm', avatar: null, members: [members[0]!], botIds: ['b1'] }}
        size={40}
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(avatarSrc('role-spring'))
  })

  it('a lone member falls back to the generated avatar', () => {
    const { container } = render(
      <GroupAvatar
        group={{ name: '支付服务重构', kind: 'group', avatar: null, members: [members[0]!], botIds: [] }}
        size={40}
      />,
    )
    expect(container.querySelector('.ui-avatar__tile')).toBeNull()
    expect(container.querySelector('svg.ui-avatar__art')?.getAttribute('data-pattern')).toMatch(/^\d+$/)
  })

  it('an uploaded image wins over the tiles, a bot image over its role', () => {
    useWorkspace.setState({ bots: [{ ...bot, avatarUrl: '/api/avatars/b.png' }] })
    const { container, rerender } = render(
      <GroupAvatar
        group={{ name: '支付服务重构', kind: 'group', avatar: '/api/avatars/g.png', members, botIds: ['b1'] }}
        size={40}
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/avatars/g.png')
    rerender(
      <GroupAvatar
        group={{ name: '小王的 Claude', kind: 'dm', avatar: null, members, botIds: ['b1'] }}
        size={40}
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/avatars/b.png')
  })
})
