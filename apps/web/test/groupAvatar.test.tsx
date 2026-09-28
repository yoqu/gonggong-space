import type { BotDto } from '@gonggong/protocol'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { avatarSrc } from '../src/features/bots/avatars'
import { GroupAvatar } from '../src/features/groups/GroupAvatar'

const bot = { id: 'b1', name: '小王的 Claude', agentKind: 'claude', avatar: 'role-devops' } as BotDto
const members = [
  { userId: 'u1', name: '王磊', isAdmin: true },
  { userId: 'u2', name: '李建国', isAdmin: false },
]

afterEach(() => useWorkspace.setState({ bots: [] }))

describe('GroupAvatar', () => {
  it('tiles people then bots, bots with their SVG art', () => {
    useWorkspace.setState({ bots: [bot] })
    const { container } = render(
      <GroupAvatar
        group={{ name: '支付服务重构', kind: 'group', members, botIds: ['b1', 'gone'] }}
        size={40}
      />,
    )
    const tiles = [...container.querySelectorAll('.ui-avatar__tile')]
    expect(tiles.map((t) => t.textContent)).toEqual(['磊', '国', ''])
    expect(tiles[2]?.querySelector('image')?.getAttribute('href')).toBe(avatarSrc('role-devops'))
  })

  it('a DM shows its bot avatar', () => {
    useWorkspace.setState({ bots: [bot] })
    const { container } = render(
      <GroupAvatar
        group={{ name: '小王的 Claude', kind: 'dm', members: [members[0]!], botIds: ['b1'] }}
        size={40}
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(avatarSrc('role-devops'))
  })

  it('a lone member falls back to the generated avatar', () => {
    const { container } = render(
      <GroupAvatar
        group={{ name: '支付服务重构', kind: 'group', members: [members[0]!], botIds: [] }}
        size={40}
      />,
    )
    expect(container.querySelector('.ui-avatar__tile')).toBeNull()
    expect(container.querySelector('svg.ui-avatar__art')?.getAttribute('data-pattern')).toMatch(/^\d+$/)
  })
})
