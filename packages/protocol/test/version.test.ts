import { describe, expect, it } from 'vitest'
import { AgentInfo, compareVersions, DaemonRelease, parseReleaseFile } from '../src/index.js'

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
  it('AgentInfo.minVersion defaults to null for daemons that do not report it', () => {
    const a = AgentInfo.parse({ kind: 'claude', available: true, version: '2.1.4', path: '/bin/claude' })
    expect(a.minVersion).toBeNull()
  })

  it('DaemonRelease requires a semver and a sha256 per build', () => {
    const ok = {
      version: '0.2.0',
      builds: { 'macos-aarch64': { url: '/downloads/gg', sha256: 'a'.repeat(64) } },
    }
    expect(DaemonRelease.parse(ok)).toEqual(ok)
    expect(DaemonRelease.safeParse({ ...ok, version: 'latest' }).success).toBe(false)
    expect(
      DaemonRelease.safeParse({ ...ok, builds: { 'macos-aarch64': { url: '/x', sha256: 'nope' } } }).success,
    ).toBe(false)
  })
})

describe('parseReleaseFile', () => {
  it('reads kind, version and platform from release.sh artifact names', () => {
    expect(parseReleaseFile('gonggong-0.2.0-macos-aarch64')).toEqual({
      kind: 'builds',
      version: '0.2.0',
      platform: 'macos-aarch64',
    })
    expect(parseReleaseFile('gg-cast-1.10.3-windows-x86_64.exe')).toEqual({
      kind: 'cast',
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
    for (const bad of [
      'Gonggong_0.3.0_aarch64.app.tar.gz',
      'Gonggong_0.3.0_x64-setup.exe.sig',
      'gg-cast',
      'gonggong-0.2.0-macos-aarch64.exe',
      'gonggong-0.2.0-windows-x86_64',
      'gonggong-0.2-linux-x86_64',
      'gonggong-0.2.0-windows-aarch64.exe',
      'SHA256SUMS',
    ])
      expect(parseReleaseFile(bad)).toBeNull()
  })
})
