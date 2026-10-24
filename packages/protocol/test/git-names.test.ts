import { describe, expect, it } from 'vitest'
import { GitActionReq, isGitRefName } from '../src/index.js'

describe('git names in write requests', () => {
  it('takes the branch and tag names git takes', () => {
    for (const ok of ['main', 'feat/退款', 'release-1.2', 'v1.0', 'origin/feat/x', 'a.b', 'x_y'])
      expect(isGitRefName(ok), ok).toBe(true)
  })

  it('refuses anything a refspec or an option would read as more', () => {
    for (const bad of [
      'HEAD',
      '@',
      '+feat:main',
      ':main',
      'feat:main',
      'refs/heads/main',
      '-f',
      'a..b',
      'a b',
      'a~1',
      'a^',
      'a?',
      'a*',
      'a[1]',
      'a\\b',
      'a@{1}',
      'feat/',
      '/feat',
      'feat//x',
      'feat.',
      'x.lock',
      '.hidden',
      'feat/.x',
      'a\u0001',
    ])
      expect(isGitRefName(bad), bad).toBe(false)
  })

  it('refuses injected push targets and remotes', () => {
    const push = (o: Record<string, unknown>) =>
      GitActionReq.safeParse({ action: 'push', branch: 'feat', ...o }).success
    expect(push({})).toBe(true)
    expect(push({ target: 'feat-v2' })).toBe(true)
    expect(push({ branch: '+feat:main' })).toBe(false)
    expect(push({ branch: 'HEAD', force: true })).toBe(false)
    expect(push({ target: ':main' })).toBe(false)
    expect(push({ remote: 'git@evil:x.git' })).toBe(false)
    expect(push({ remote: '/tmp/x' })).toBe(false)
    expect(push({ remote: '--receive-pack=x' })).toBe(false)
    expect(GitActionReq.safeParse({ action: 'tag-push', name: ':v1' }).success).toBe(false)
    expect(GitActionReq.safeParse({ action: 'branch-delete', branch: 'origin/:main' }).success).toBe(false)
  })

  it('keeps any revision for a detached checkout but no option', () => {
    const co = (branch: string) =>
      GitActionReq.safeParse({ action: 'checkout', branch, detach: true }).success
    expect(co('HEAD~2')).toBe(true)
    expect(co('v1.0^{}')).toBe(true)
    expect(co('--orphan')).toBe(false)
    expect(co('a b')).toBe(false)
  })
})
