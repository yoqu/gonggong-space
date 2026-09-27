import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publicRepoUrl, repoKey, repoName } from '../src/index.js'

const cases: { url: string; key: string }[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '../cases/repo-keys.json'), 'utf8'),
)

describe('repoKey (cases shared with the Rust daemon)', () => {
  for (const c of cases) it(c.url, () => expect(repoKey(c.url)).toBe(c.key))

  it('is null for addresses that are not remote git URLs', () => {
    expect(repoKey('not a url')).toBeNull()
    expect(repoKey('file:///tmp/repo')).toBeNull()
  })
})

describe('publicRepoUrl', () => {
  it('drops credentials but keeps everything else', () => {
    expect(publicRepoUrl('https://oauth2:tok3n@git.corp:8443/team/app.git')).toBe(
      'https://git.corp:8443/team/app.git',
    )
    expect(publicRepoUrl('https://tok3n@github.com/org/app')).toBe('https://github.com/org/app')
    expect(publicRepoUrl('git@git.corp:team/app.git')).toBe('git@git.corp:team/app.git')
    expect(publicRepoUrl('ssh://git@git.corp:2222/team/app')).toBe('ssh://git@git.corp:2222/team/app')
  })
})

describe('repoName', () => {
  it('is the last path segment in its original case', () => {
    expect(repoName('git@git.corp:team/sub/MyApp.git')).toBe('MyApp')
    expect(repoName('https://github.com/org/app/')).toBe('app')
  })
})
