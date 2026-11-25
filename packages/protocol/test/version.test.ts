import { describe, expect, it } from 'vitest'
import { AgentState, compareVersions, DaemonRelease, parseReleaseFile, UpgradeInfo } from '../src/index.js'

describe('compareVersions', () => {
  it('orders dotted numeric versions, ignoring pre-release / build suffixes', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('2.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.9.99', '2.0')).toBeLessThan(0)
    expect(compareVersions('2.1.4-beta', '2.1.4')).toBe(0)
  })
})

describe('contracts', () => {
  const release = {
    version: '0.2.0',
    builds: { 'macos-aarch64': { url: '/downloads/gg', sha256: 'a'.repeat(64) } },
  }

  it('AgentState.minVersion defaults to null for daemons that do not report it', () => {
    const a = AgentState.parse({ kind: 'claude', available: true, version: '2.1.4', path: '/bin/claude' })
    expect(a.minVersion).toBeNull()
  })

  it('DaemonRelease requires a semver and a sha256 per build', () => {
    expect(DaemonRelease.parse(release)).toEqual(release)
    expect(DaemonRelease.safeParse({ ...release, version: 'latest' }).success).toBe(false)
    expect(
      DaemonRelease.safeParse({ ...release, builds: { 'macos-aarch64': { url: '/x', sha256: 'nope' } } })
        .success,
    ).toBe(false)
  })

  it('accepts release notes on releases and upgrades, and old payloads without them', () => {
    const notes = '## 0.2.0\n\n- 模型选择更准确'
    expect(DaemonRelease.parse({ ...release, releaseNotes: notes }).releaseNotes).toBe(notes)
    expect(
      UpgradeInfo.parse({ version: '0.2.0', url: '/downloads/gg', sha256: 'a'.repeat(64) }).releaseNotes,
    ).toBe(undefined)
    expect(
      UpgradeInfo.parse({
        version: '0.2.0',
        url: '/downloads/gg',
        sha256: 'a'.repeat(64),
        releaseNotes: notes,
      }).releaseNotes,
    ).toBe(notes)
  })
})

describe('parseReleaseFile', () => {
  it('reads kind, version and platform from release.sh artifact names', () => {
    expect(parseReleaseFile('gonggong-0.2.0-macos-aarch64')).toEqual({
      kind: 'builds',
      version: '0.2.0',
      platform: 'macos-aarch64',
    })
    expect(parseReleaseFile('gonggong-1.10.3-windows-x86_64.exe')).toEqual({
      kind: 'builds',
      version: '1.10.3',
      platform: 'windows-x86_64',
    })
    expect(parseReleaseFile('Gonggong_0.3.0_aarch64.dmg')).toEqual({
      kind: 'desktop',
      version: '0.3.0',
      platform: 'macos-aarch64',
    })
    expect(parseReleaseFile('Gonggong_0.3.0_x86_64.dmg')?.platform).toBe('macos-x86_64')
    expect(parseReleaseFile('Gonggong_0.3.0_x64-setup.exe')?.platform).toBe('windows-x86_64')
    expect(parseReleaseFile('Gonggong_0.3.2_aarch64.app.tar.gz')).toEqual({
      kind: 'update',
      version: '0.3.2',
      platform: 'macos-aarch64',
    })
    expect(parseReleaseFile('Gonggong_0.3.2_x86_64.app.tar.gz.sig')).toEqual({
      kind: 'signature',
      version: '0.3.2',
      platform: 'macos-x86_64',
    })
    expect(parseReleaseFile('Gonggong_0.3.2_x64-setup.exe.sig')).toEqual({
      kind: 'signature',
      version: '0.3.2',
      platform: 'windows-x86_64',
    })
    for (const bad of [
      'Gonggong_0.3.0_aarch64.dmg.sig',
      'Gonggong_0.3.0_x64-setup.exe.tar.gz',
      'gg-cast',
      'gg-cast-1.10.3-windows-x86_64.exe',
      'gonggong-0.2.0-macos-aarch64.exe',
      'gonggong-0.2.0-windows-x86_64',
      'gonggong-0.2-linux-x86_64',
      'gonggong-0.2.0-windows-aarch64.exe',
      'SHA256SUMS',
    ])
      expect(parseReleaseFile(bad)).toBeNull()
  })
})
