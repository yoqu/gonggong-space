import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { App } from '../src/App'

afterEach(() => vi.unstubAllGlobals())

it('shows server connectivity from /api/health', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true, protocol: 1 }))),
  )
  render(<App />)
  expect(await screen.findByText('已连接 · 协议 v1')).toBeTruthy()
})
