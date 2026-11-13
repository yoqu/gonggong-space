import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { MemberPicker } from '../src/features/groups/pickers'
import { matchAny, matchText, pinyinReady } from '../src/lib/match'
import { filterMembers, MentionPicker } from '../src/ui/im/pickers'

beforeAll(() => pinyinReady)

describe('name search', () => {
  it('matches Chinese names by full pinyin, initials, mixed and any case', () => {
    for (const q of ['jwc', 'JWC', 'jiangweichuan', 'JiangWC', 'weichuan', 'jiang wei', '维川', 'jiangw'])
      expect(matchText('姜维川', q), q).not.toBeNull()
    expect(matchText('共字君codex', 'gzj')).toEqual([0, 1, 2])
    expect(matchText('共字君codex', 'codex')).toEqual([3, 4, 5, 6, 7])
    expect(matchText('重庆', 'cq')).toEqual([0, 1])
    expect(matchText('姜维川', 'xyz')).toBeNull()
    expect(matchText('alice', 'ae')).toBeNull()
  })

  it('treats an empty query as matching everything and checks every field', () => {
    expect(matchAny('  ', '姜维川')).toBe(true)
    expect(matchAny('yoqu', '姜维川', 'yoqu@example.com')).toBe(true)
    expect(matchAny('lb', '姜维川', undefined)).toBe(false)
  })

  it('filters @ candidates by pinyin and bolds the hit characters', () => {
    const members = [{ name: '姜维川' }, { name: '李四' }]
    expect(filterMembers(members, 'jwc', false).map((m) => m.name)).toEqual(['姜维川'])
    expect(filterMembers(members, 'syr').map((m) => m.name)).toEqual(['所有人'])
    const { container } = render(<MentionPicker members={members} query="wc" includeAll={false} />)
    expect([...container.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['维川'])
  })

  it('finds a user to add by pinyin initials', () => {
    const users = [
      { id: 'u1', name: '姜维川', account: 'yoqu', avatar: null },
      { id: 'u2', name: '李四', account: 'lisi', avatar: null },
    ]
    render(
      <MemberPicker
        users={users}
        onAdd={() => {}}
        defaultOpen
        trigger={<button type="button">添加</button>}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索成员' }), { target: { value: 'JWC' } })
    expect(screen.getAllByRole('menuitemcheckbox').map((r) => r.textContent)).toEqual(['姜维川yoqu'])
  })
})
