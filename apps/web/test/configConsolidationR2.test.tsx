import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { McpServerDto } from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMcpLayer } from '../src/features/config/ConfigPage'
import { FolderInput, kb } from '../src/features/config/SkillLayer'
import { api } from '../src/lib/api'

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '../src', rel), 'utf8')

function McpProbe({ base }: { base: string }) {
  const layer = useMcpLayer(base)
  return (
    <div>
      <span data-testid="loading">{String(layer.loading)}</span>
      <span data-testid="dirty">{String(layer.dirty)}</span>
      <span data-testid="names">{layer.items?.map((i) => i.config.name).join(',') ?? 'null'}</span>
      {layer.items?.[0] ? (
        <button type="button" onClick={() => layer.remove(layer.items![0]!)}>
          remove-first
        </button>
      ) : null}
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Round 2 Consolidation — Slice 2 (Config, Plugins, Market)', () => {
  it('P0-4: useMcpLayer resets draft state on base change and ignores stale responses', async () => {
    const server = (id: string, name: string): McpServerDto => ({
      id,
      enabled: true,
      config: { name, transport: 'http', url: 'https://example.com', headers: {} },
      updatedAt: '2026-11-22T00:00:00Z',
    })
    let resolveG1!: (v: McpServerDto[]) => void
    let resolveG2!: (v: McpServerDto[]) => void
    let g1Count = 0
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path === '/groups/g1/mcp') {
        g1Count += 1
        if (g1Count === 1) return Promise.resolve([server('m1', 'alpha')])
        return new Promise<McpServerDto[]>((r) => {
          resolveG1 = r
        })
      }
      if (path === '/groups/g2/mcp') {
        return new Promise<McpServerDto[]>((r) => {
          resolveG2 = r
        })
      }
      return Promise.resolve([])
    })

    const { rerender } = render(<McpProbe base="/groups/g1/mcp" />)
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('alpha'))
    expect(screen.getByTestId('loading').textContent).toBe('false')

    // Mark a saved server removed -> dirty becomes true.
    fireEvent.click(screen.getByText('remove-first'))
    expect(screen.getByTestId('dirty').textContent).toBe('true')

    // Switch to g2: dirty & items reset immediately.
    rerender(<McpProbe base="/groups/g2/mcp" />)
    expect(screen.getByTestId('dirty').textContent).toBe('false')
    expect(screen.getByTestId('names').textContent).toBe('null')
    expect(screen.getByTestId('loading').textContent).toBe('true')

    // Switch back to g1 (slow) then g2 (fast) to test stale response discarding.
    rerender(<McpProbe base="/groups/g1/mcp" />)
    rerender(<McpProbe base="/groups/g2/mcp" />)
    resolveG2([server('m2', 'beta')])
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('beta'))
    expect(screen.getByTestId('loading').textContent).toBe('false')

    // Now the stale g1 response settles late — must NOT overwrite g2!
    resolveG1([server('m1-stale', 'stale-alpha')])
    await Promise.resolve()
    expect(screen.getByTestId('names').textContent).toBe('beta')
  })

  it('P1-1: ConfigPage uses GONGGONG_TOOL_TITLES instead of bundling GONGGONG_TOOLS schemas', () => {
    const src = readSrc('features/config/ConfigPage.tsx')
    expect(src).toContain('GONGGONG_TOOL_TITLES')
    expect(src).not.toContain('GONGGONG_TOOLS')
  })

  it('P1-4: FolderInput uses inputRef directly and PluginLayer/MyListings drop querySelector hacks', () => {
    expect(kb(512)).toBe('512 B')
    expect(kb(2048)).toBe('2.0 KB')
    expect(kb(20480)).toBe('20 KB')

    const ref = { current: null as HTMLInputElement | null }
    const onFiles = vi.fn()
    render(<FolderInput inputRef={ref} label="上传文件夹" onFiles={onFiles} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current?.hasAttribute('webkitdirectory')).toBe(true)

    expect(readSrc('features/config/SkillLayer.tsx')).not.toContain("querySelector('input')")
    expect(readSrc('features/plugins/PluginLayer.tsx')).not.toContain("querySelector('input')")
    expect(readSrc('features/market/MyListings.tsx')).not.toContain("querySelector('input')")
  })
})
