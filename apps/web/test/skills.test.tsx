import type { SkillDetailDto, SkillDto, SkillVersionDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { strToU8, zipSync } from 'fflate'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { skillFiles, zipSkillFiles } from '../src/features/config/skillFiles'
import { mockApi } from './mockApi'

const admin: UserDto = {
  id: 'u0',
  account: 'chenchen',
  name: '陈晨',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const md = (name: string, body = '') => `---\nname: ${name}\ndescription: ${name} helper\n---\n${body}`
const review: SkillDto = {
  id: 's1',
  name: 'review-pr',
  description: '按团队规范审查当前分支 diff',
  enabled: true,
  versionId: 'v2',
  version: 2,
  size: 2048,
  updatedBy: '陈晨',
  updatedAt: new Date().toISOString(),
}
const reviewDetail: SkillDetailDto = {
  ...review,
  files: [
    { path: 'SKILL.md', content: md('review-pr', 'v2 body'), encoding: 'utf8' },
    { path: 'logo.png', content: 'AAEC', encoding: 'base64' },
  ],
}
const versions: SkillVersionDto[] = [
  {
    id: 'v2',
    version: 2,
    digest: 'b',
    size: 2048,
    createdBy: '陈晨',
    createdAt: review.updatedAt,
    current: true,
  },
  {
    id: 'v1',
    version: 1,
    digest: 'a',
    size: 1024,
    createdBy: '陈晨',
    createdAt: review.updatedAt,
    current: false,
  },
]

class NoopSocket {
  close() {}
}

const base = {
  'GET /admin/mcp': [],
  'GET /bots': [],
  'GET /machines': [],
  'GET /notifications': [],
}

async function openSkills() {
  render(
    <MemoryRouter initialEntries={['/admin/config']}>
      <App />
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('tab', { name: 'Skill' }))
}

const row = (name: string) => screen.getByText(name).closest('.cfg__item') as HTMLElement

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: admin, status: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

describe('skill files', () => {
  it('reads a zip of one folder: strips the shared top folder, drops OS junk, keeps binaries as base64', async () => {
    const zip = zipSync({
      'review/SKILL.md': strToU8(md('review')),
      'review/scripts/run.sh': strToU8('echo hi\n'),
      'review/logo.png': new Uint8Array([0xff, 0xfe, 0x00]),
      '__MACOSX/review/._SKILL.md': strToU8('x'),
      'review/.DS_Store': strToU8('x'),
    })
    expect(await zipSkillFiles(new Blob([zip]))).toEqual([
      { path: 'SKILL.md', content: md('review'), encoding: 'utf8' },
      { path: 'logo.png', content: '//4A', encoding: 'base64' },
      { path: 'scripts/run.sh', content: 'echo hi\n', encoding: 'utf8' },
    ])
    // A folder whose SKILL.md is at the root keeps its paths.
    expect(
      skillFiles([
        ['SKILL.md', strToU8('a')],
        ['docs/a.md', strToU8('b')],
      ]).map((f) => f.path),
    ).toEqual(['SKILL.md', 'docs/a.md'])
  })
})

describe('配置中心 · Skill', () => {
  it('lists the layer with namespace, version and author; toggles and deletes at once', async () => {
    const calls = mockApi({
      ...base,
      'GET /admin/skills': [review],
      'PATCH /admin/skills/s1': { ...review, enabled: false },
      'DELETE /admin/skills/s1': undefined,
    })
    await openSkills()
    await screen.findByText('/gonggong-team:review-pr')
    const r = row('/gonggong-team:review-pr')
    expect(r.textContent).toContain('平台层')
    expect(r.textContent).toContain('v2')
    expect(r.textContent).toContain('按团队规范审查当前分支 diff')
    expect(r.textContent).toContain('陈晨 · 刚刚 · 2.0 KB')

    fireEvent.click(within(r).getByRole('switch'))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/admin/skills/s1', body: { enabled: false } }),
    )

    fireEvent.click(within(r).getByRole('button', { name: '删除 review-pr' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm.textContent).toContain('删除后历史版本一并移除')
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/admin/skills/s1', body: undefined }),
    )
  })

  it('adds a skill from the template with an extra file, and shows the server error in the dialog', async () => {
    let first = true
    const calls = mockApi({
      ...base,
      'GET /admin/skills': [],
      'POST /admin/skills': () => {
        if (!first) return { ...reviewDetail, id: 's9' }
        first = false
        return new Response(JSON.stringify({ error: 'invalid', message: 'SKILL.md 缺少 frontmatter' }), {
          status: 400,
        })
      },
    })
    await openSkills()
    expect(await screen.findByText('还没有 Skill')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '添加 Skill…' }))
    const dialog = await screen.findByRole('dialog', { name: '添加 Skill' })
    const editor = within(dialog).getByLabelText('SKILL.md') as HTMLTextAreaElement
    expect(editor.value).toContain('name: my-skill')
    fireEvent.change(editor, { target: { value: md('lint', 'Run lint.') } })
    fireEvent.change(within(dialog).getByLabelText('新文件路径'), { target: { value: 'scripts/lint.sh' } })
    fireEvent.keyDown(within(dialog).getByLabelText('新文件路径'), { key: 'Enter' })
    fireEvent.change(within(dialog).getByLabelText('scripts/lint.sh'), { target: { value: 'pnpm lint\n' } })

    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await within(dialog).findByText('SKILL.md 缺少 frontmatter')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加 Skill' })).toBeNull())
    expect(calls.filter((c) => c.method === 'POST').at(-1)!.body).toEqual({
      enabled: true,
      files: [
        { path: 'SKILL.md', content: md('lint', 'Run lint.'), encoding: 'utf8' },
        { path: 'scripts/lint.sh', content: 'pnpm lint\n', encoding: 'utf8' },
      ],
    })
  })

  it('edits the current files, keeps binaries read-only, and replaces them from a zip', async () => {
    const calls = mockApi({
      ...base,
      'GET /admin/skills': [review],
      'GET /admin/skills/s1': reviewDetail,
      'PATCH /admin/skills/s1': reviewDetail,
    })
    await openSkills()
    await screen.findByText('/gonggong-team:review-pr')
    fireEvent.click(within(row('/gonggong-team:review-pr')).getByRole('button', { name: '编辑 review-pr' }))
    const dialog = await screen.findByRole('dialog', { name: '编辑 Skill review-pr' })
    expect(((await within(dialog).findByLabelText('SKILL.md')) as HTMLTextAreaElement).value).toContain(
      'v2 body',
    )
    fireEvent.click(within(dialog).getByRole('option', { name: 'logo.png' }))
    expect(within(dialog).getByText('二进制文件')).toBeTruthy()

    const zip = zipSync({ 'x/SKILL.md': strToU8(md('review-pr', 'from zip')) })
    fireEvent.change(within(dialog).getByLabelText('导入 zip'), {
      target: { files: [new File([zip], 'x.zip', { type: 'application/zip' })] },
    })
    await waitFor(() =>
      expect((within(dialog).getByLabelText('SKILL.md') as HTMLTextAreaElement).value).toContain('from zip'),
    )
    expect(within(dialog).queryByRole('option', { name: 'logo.png' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/admin/skills/s1',
        body: { files: [{ path: 'SKILL.md', content: md('review-pr', 'from zip'), encoding: 'utf8' }] },
      }),
    )
  })

  it('shows the version history, previews a version and rolls back to it', async () => {
    const calls = mockApi({
      ...base,
      'GET /admin/skills': [review],
      'GET /admin/skills/s1/versions': versions,
      'GET /admin/skills/s1/versions/v1': {
        ...versions[1],
        files: [{ path: 'SKILL.md', content: md('review-pr', 'v1 body'), encoding: 'utf8' }],
      },
      'POST /admin/skills/s1/rollback': { ...reviewDetail, version: 1, versionId: 'v1' },
    })
    await openSkills()
    await screen.findByText('/gonggong-team:review-pr')
    fireEvent.click(
      within(row('/gonggong-team:review-pr')).getByRole('button', { name: '历史版本 review-pr' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'review-pr 的历史版本' })
    await within(dialog).findByText('v1')
    const v2 = within(dialog).getByText('v2').closest('.cfg__item') as HTMLElement
    const v1 = within(dialog).getByText('v1').closest('.cfg__item') as HTMLElement
    expect(v2.textContent).toContain('当前')
    expect((within(v2).getByRole('button', { name: '回滚到此版本' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(within(v1).getByRole('button', { name: '查看' }))
    expect(await within(dialog).findByText(/v1 body/)).toBeTruthy()
    expect(within(dialog).getByText('v1 · 1 个文件')).toBeTruthy()
    fireEvent.click(within(v1).getByRole('button', { name: '回滚到此版本' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/admin/skills/s1/rollback',
        body: { versionId: 'v1' },
      }),
    )
  })
})
