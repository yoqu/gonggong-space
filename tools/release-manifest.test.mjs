import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { releaseManifest, releaseNotes, updaterManifest } from '../scripts/release/manifest.mjs'

test('release notes are optional but carried into both manifests when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gonggong-release-'))
  const file = join(dir, 'RELEASE_NOTES.md')
  writeFileSync(file, '\n## 0.3.5\n\n- 桌面端显示说明\n')
  const notes = releaseNotes(file)
  assert.equal(notes, '## 0.3.5\n\n- 桌面端显示说明')
  assert.deepEqual(releaseManifest('0.3.5', '{"macos-aarch64":{}}', notes), {
    version: '0.3.5',
    releaseNotes: notes,
    builds: { 'macos-aarch64': {} },
  })
  assert.deepEqual(updaterManifest('0.3.5', notes, '2026-10-21T00:00:00Z', '{"darwin-aarch64":{}}'), {
    version: '0.3.5',
    notes,
    pub_date: '2026-10-21T00:00:00Z',
    platforms: { 'darwin-aarch64': {} },
  })
})

test('missing notes do not block manifests', () => {
  assert.equal(releaseNotes(), undefined)
  assert.deepEqual(releaseManifest('0.3.5', '{}'), { version: '0.3.5', builds: {} })
  assert.deepEqual(updaterManifest('0.3.5', undefined, '2026-10-21T00:00:00Z', '{}'), {
    version: '0.3.5',
    pub_date: '2026-10-21T00:00:00Z',
    platforms: {},
  })
})
