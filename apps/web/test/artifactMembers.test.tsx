import type { ArtifactMemberDto, TeamMemberDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactMembers } from '../src/features/artifacts/ArtifactMembers'
import { mockApi } from './mockApi'

const tm = (userId: string, name: string): TeamMemberDto => ({
  userId,
  name,
  account: userId,
  avatar: null,
  role: 'member',
  joinedAt: '2026-01-01T00:00:00Z',
})
const TEAM = [tm('u1', '蒋庆'), tm('u2', '张三'), tm('u3', '李四')]
const ZHANG: ArtifactMemberDto = { userId: 'u2', name: '张三', avatar: null, role: 'view' }

afterEach(() => vi.unstubAllGlobals())

describe('作品成员权限', () => {
  it('lets a manager give someone of the team edit access, change it and take it back', async () => {
    const calls = mockApi({
      'GET /artifacts/a1/members': [ZHANG],
      'GET /teams/t1/members': TEAM,
      'PUT /artifacts/a1/members/u3': [ZHANG, { userId: 'u3', name: '李四', avatar: null, role: 'edit' }],
      'PUT /artifacts/a1/members/u2': [{ ...ZHANG, role: 'edit' }],
      'DELETE /artifacts/a1/members/u2': [],
    })
    render(<ArtifactMembers artifactId="a1" teamId="t1" createdBy="u1" canManage />)
    const list = await screen.findByRole('list', { name: '成员权限' })
    const names = () => [...list.querySelectorAll('.art-members__name')].map((n) => n.textContent)
    expect(names()).toEqual(['张三'])

    fireEvent.click(screen.getByRole('button', { name: '选择成员' }))
    // The creator and those already given access are not offered.
    expect(screen.queryByRole('menuitemcheckbox', { name: '蒋庆' })).toBeNull()
    expect(screen.queryByRole('menuitemcheckbox', { name: '张三' })).toBeNull()
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '李四' }))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(names()).toEqual(['张三', '李四']))
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ role: 'edit' })

    fireEvent.click(screen.getByRole('button', { name: '张三 的权限' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '可协作' }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/artifacts/a1/members/u2')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: '移除 张三' }))
    await screen.findByText('还没有单独授权的人')
  })

  it('only lists who has access for everyone else', async () => {
    const calls = mockApi({ 'GET /artifacts/a1/members': [ZHANG] })
    render(<ArtifactMembers artifactId="a1" teamId="t1" createdBy="u1" canManage={false} />)
    await screen.findByText('可看')
    expect(screen.queryByRole('button', { name: '添加' })).toBeNull()
    expect(calls.some((c) => c.path.startsWith('/teams/'))).toBe(false)
  })
})
