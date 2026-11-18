import { describe, expect, it } from 'vitest'
import { PluginManifest, SecretRequirements, secretSpecsOf } from '../src/index.js'

const plugin = {
  name: 'dw',
  version: '1.0.0',
  title: '数仓',
  description: '数仓',
  category: 'tool',
  agents: ['claude'],
  minDaemon: '0.5.0',
  entry: null,
}
const mcp = (env: Record<string, string>) => ({
  contributes: { mcp: [{ name: 'dw', transport: 'stdio', command: ['dw'], env }] },
  permissions: ['exec'],
})

describe('SecretRequirements', () => {
  it('reads bare names as required shared secrets and objects with defaults', () => {
    expect(
      SecretRequirements.parse([
        'OLD_KEY',
        { name: 'DW_KEY', title: '正式 Key', mode: 'personal', url: 'https://dw.example.com/keys' },
        { name: 'DW_TEST_KEY', required: false },
      ]),
    ).toEqual([
      { name: 'OLD_KEY', description: '', mode: 'shared', required: true },
      {
        name: 'DW_KEY',
        title: '正式 Key',
        description: '',
        mode: 'personal',
        url: 'https://dw.example.com/keys',
        required: true,
      },
      { name: 'DW_TEST_KEY', description: '', mode: 'shared', required: false },
    ])
  })

  it('rejects duplicate names, bad names and non-https links', () => {
    expect(SecretRequirements.safeParse(['DW_KEY', { name: 'DW_KEY' }]).success).toBe(false)
    expect(SecretRequirements.safeParse(['dw_key']).success).toBe(false)
    expect(SecretRequirements.safeParse([{ name: 'DW_KEY', url: 'http://dw.example.com' }]).success).toBe(
      false,
    )
    expect(SecretRequirements.safeParse(Array.from({ length: 11 }, (_, i) => `KEY_${i}`)).success).toBe(false)
  })
})

describe('PluginManifest secrets', () => {
  it('keeps `secrets` as the required names and the full declaration in `secretSpecs`', () => {
    const m = PluginManifest.parse({
      ...plugin,
      secrets: ['OLD_KEY', { name: 'DW_TEST_KEY', required: false, mode: 'personal' }],
    })
    expect(m.secrets).toEqual(['OLD_KEY'])
    expect(m.secretSpecs?.map((s) => [s.name, s.required, s.mode])).toEqual([
      ['OLD_KEY', true, 'shared'],
      ['DW_TEST_KEY', false, 'personal'],
    ])
    // Stored and parsed again, it stays the same.
    expect(PluginManifest.parse(JSON.parse(JSON.stringify(m)))).toEqual(m)
  })

  it('lets MCP config reference required secrets only', () => {
    expect(
      PluginManifest.safeParse({ ...plugin, ...mcp({ K: '${secret:OLD_KEY}' }), secrets: ['OLD_KEY'] })
        .success,
    ).toBe(true)
    const optional = PluginManifest.safeParse({
      ...plugin,
      ...mcp({ K: '${secret:DW_TEST_KEY}' }),
      secrets: [{ name: 'DW_TEST_KEY', required: false }],
    })
    expect(optional.success).toBe(false)
  })

  it('reads snapshots stored before declarations', () => {
    expect(secretSpecsOf({ secrets: ['OLD_KEY'] })).toEqual([
      { name: 'OLD_KEY', description: '', mode: 'shared', required: true },
    ])
  })
})
