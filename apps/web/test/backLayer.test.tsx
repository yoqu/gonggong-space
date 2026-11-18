import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useBackLayer } from '../src/app/backLayer'

let nav: ReturnType<typeof useNavigate>
let setThread: (open: boolean) => void
let setBench: (open: boolean) => void

function Layers({ enabled = true }: { enabled?: boolean }) {
  nav = useNavigate()
  const path = useLocation().pathname
  const [thread, setT] = useState(false)
  const [bench, setB] = useState(false)
  setThread = setT
  setBench = setB
  useBackLayer('thread', thread, () => setT(false), enabled)
  useBackLayer('bench', bench, () => setB(false), enabled)
  return (
    <>
      <div>{`${thread ? '话题' : ''}|${bench ? '工作台' : ''}`}</div>
      <output>{path}</output>
    </>
  )
}

const shown = () => screen.getByText(/\|/).textContent

describe('back layers on phones', () => {
  it('closes the top layer on back: workbench opened from a thread returns to the thread, then the chat', async () => {
    render(
      <MemoryRouter initialEntries={['/g/1']}>
        <Layers />
      </MemoryRouter>,
    )
    act(() => setThread(true))
    act(() => setBench(true))
    expect(shown()).toBe('话题|工作台')
    await act(async () => nav(-1))
    expect(shown()).toBe('话题|')
    await act(async () => nav(-1))
    expect(shown()).toBe('|')
  })

  it('takes its history entry back when closed from the page, so back then leaves the chat', async () => {
    render(
      <MemoryRouter initialEntries={['/list', '/g/1']} initialIndex={1}>
        <Layers />
      </MemoryRouter>,
    )
    act(() => setBench(true))
    act(() => setBench(false))
    await act(async () => {})
    await act(async () => nav(-1))
    expect(screen.getByRole('status').textContent).toBe('/list')
  })

  it('leaves history alone when disabled (desktop)', async () => {
    render(
      <MemoryRouter initialEntries={['/list', '/g/1']} initialIndex={1}>
        <Layers enabled={false} />
      </MemoryRouter>,
    )
    act(() => setBench(true))
    await act(async () => nav(-1))
    expect(shown()).toBe('|工作台')
  })
})
