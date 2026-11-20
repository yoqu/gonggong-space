import type { ArtifactDto, BotDto, WebEvent } from '@gonggong/protocol'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { ActivityLayer, ActivityNote } from '../src/features/artifacts/ActivityLayer'
import { resetActivity } from '../src/features/artifacts/activity'
import { RunArtifactsLine } from '../src/features/artifacts/CanvasRefs'
import type { CanvasNode } from '../src/features/artifacts/geometry'
import { loadArtifact, resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

// Plan 原型协作 P1: which screens a run is writing, and its version landing.

const bots = [{ id: 'b1', name: '共字君' }] as BotDto[]
const node = (id: string, x: number): CanvasNode => ({
  id,
  kind: 'screen',
  title: id,
  file: `screens/${id}.html`,
  x,
  y: 0,
  w: 100,
  h: 200,
})
const nodes = [node('home', 0), node('done', 200)]
const artifact = (head: { id: string; runId: string | null }) =>
  ({
    id: 'a1',
    groupId: 'g1',
    title: '外卖',
    head: { ...head, n: 1 },
    activity: [],
  }) as unknown as ArtifactDto
const writing = (screens: string[], runId = 'r1') => ({
  runId,
  botId: 'b1',
  title: '外卖',
  screens: screens.map((id) => ({ id, title: id === 'home' ? '首页' : id })),
  global: false,
})

let emit: (e: WebEvent) => void = () => {}
beforeEach(() => {
  resetActivity()
  resetArtifacts()
  useWorkspace.setState({ bots })
  vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
    emit = h as (e: WebEvent) => void
    return () => {}
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('activity on the canvas', () => {
  it('marks the screens a run is writing, then the ones its new head changed', async () => {
    mockApi({ 'GET /artifacts/a1': artifact({ id: 'v1', runId: null }), 'GET /artifacts/a1/versions': [] })
    await loadArtifact('a1')
    render(
      <>
        <ActivityNote artifactId="a1" />
        <ActivityLayer artifactId="a1" nodes={nodes} />
      </>,
    )
    expect(screen.queryByTestId('art-activity-home')).toBeNull()
    act(() => emit({ t: 'artifact.activity', artifactId: 'a1', activity: [writing(['home'])] }))
    const mark = screen.getByTestId('art-activity-home')
    expect(mark.className).toBe('art-activity')
    expect(mark.textContent).toBe('共字君 正在改')
    expect(screen.queryByTestId('art-activity-done')).toBeNull()
    expect(screen.getByTestId('art-activity-note').textContent).toBe('正在改 首页')

    // The run ends, then its version becomes the head: the screen it wrote lands.
    act(() => emit({ t: 'artifact.activity', artifactId: 'a1', activity: [] }))
    expect(screen.queryByTestId('art-activity-note')).toBeNull()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockApi({ 'GET /artifacts/a1': artifact({ id: 'v2', runId: 'r1' }), 'GET /artifacts/a1/versions': [] })
    await act(() => loadArtifact('a1'))
    expect(screen.getByTestId('art-activity-home').className).toBe('art-landed')
    act(() => vi.advanceTimersByTime(2200))
    expect(screen.queryByTestId('art-activity-home')).toBeNull()
  })

  it('does not land a head made by someone else', async () => {
    mockApi({ 'GET /artifacts/a1': artifact({ id: 'v1', runId: null }), 'GET /artifacts/a1/versions': [] })
    await loadArtifact('a1')
    render(<ActivityLayer artifactId="a1" nodes={nodes} />)
    act(() => emit({ t: 'artifact.activity', artifactId: 'a1', activity: [writing(['home'])] }))
    mockApi({ 'GET /artifacts/a1': artifact({ id: 'v2', runId: null }), 'GET /artifacts/a1/versions': [] })
    await act(() => loadArtifact('a1'))
    expect(screen.queryByTestId('art-activity-home')).toBeNull()
  })

  it('positions overlays in screen space and hides the badge when the scaled screen is too narrow', () => {
    const wide = [{ ...node('home', 100), y: 50, w: 400, h: 800 }]
    const { rerender } = render(
      <ActivityLayer artifactId="a1" nodes={wide} view={{ x: 20, y: 10, z: 0.34 }} />,
    )
    act(() => emit({ t: 'artifact.activity', artifactId: 'a1', activity: [writing(['home'])] }))
    const mark = screen.getByTestId('art-activity-home')
    expect(mark.style.left).toBe('54px')
    expect(mark.style.top).toBe('27px')
    expect(mark.style.width).toBe('136px')
    expect(mark.style.height).toBe('272px')
    expect(mark.textContent).toBe('共字君 正在改')

    rerender(<ActivityLayer artifactId="a1" nodes={wide} view={{ x: 20, y: 10, z: 0.15 }} />)
    const tiny = screen.getByTestId('art-activity-home')
    expect(tiny.style.width).toBe('60px')
    expect(tiny.textContent).toBe('')
  })
})

describe('activity on the run card', () => {
  it('says what the run is writing and opens those screens', () => {
    render(<RunArtifactsLine artifacts={[]} runId="r1" />)
    expect(screen.queryByTestId('run-artifact-activity')).toBeNull()
    act(() =>
      emit({
        t: 'artifact.activity',
        artifactId: 'a1',
        activity: [{ ...writing(['home', 'done']), global: true }, writing(['home'], 'r2')],
      }),
    )
    const line = screen.getByTestId('run-artifact-activity')
    expect(line.textContent).toBe('外卖 · 正在改 首页、done 和全局样式')
  })
})
