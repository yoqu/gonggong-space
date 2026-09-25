import { describe, expect, it } from 'vitest'
import { AgentInfo, compareVersions, DaemonRelease } from '../src/index.js'

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
