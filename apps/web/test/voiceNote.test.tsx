import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceNote } from '../src/ui'

let play: ReturnType<typeof vi.spyOn>
let pause: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'))
  })
})
afterEach(() => vi.restoreAllMocks())

describe('VoiceNote', () => {
  it('shows the length and a seek slider before it plays', () => {
    render(<VoiceNote src="/a.mp3" duration={53} label="a.mp3" />)
    const slider = screen.getByRole('slider', { name: '播放进度' })
    expect(slider.getAttribute('aria-valuemax')).toBe('53')
    expect(slider.getAttribute('aria-valuetext')).toBe('0:00 / 0:53')
    expect(screen.getByRole('button', { name: '播放速度 1×' }).textContent).toBe('0:53')
  })

  it('plays and pauses the audio, morphing the control', async () => {
    const onPlayingChange = vi.fn()
    const { container } = render(<VoiceNote src="/a.mp3" duration={9} onPlayingChange={onPlayingChange} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '播放语音' })))
    expect(play).toHaveBeenCalled()
    expect(onPlayingChange).toHaveBeenLastCalledWith(true)
    expect(container.querySelector('.ui-voice')?.getAttribute('data-playing')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(pause).toHaveBeenCalled()
    expect(onPlayingChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: '播放语音' })).toBeTruthy()
  })

  it('starting one note pauses the one already playing', async () => {
    render(
      <>
        <VoiceNote src="/a.mp3" duration={9} label="a" />
        <VoiceNote src="/b.mp3" duration={9} label="b" />
      </>,
    )
    const [a, b] = screen.getAllByRole('button', { name: '播放语音' })
    await act(async () => fireEvent.click(a as HTMLElement))
    await act(async () => fireEvent.click(b as HTMLElement))
    expect(screen.getAllByRole('button', { name: '暂停' })).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'b' }).querySelector('[aria-label="暂停"]')).toBeTruthy()
  })

  it('seeks with the arrow keys, Home and End', () => {
    const { container } = render(<VoiceNote src="/a.mp3" duration={30} />)
    const audio = container.querySelector('audio') as HTMLAudioElement
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(audio.currentTime).toBe(5)
    expect(slider.getAttribute('aria-valuenow')).toBe('5')
    fireEvent.keyDown(slider, { key: 'End' })
    expect(audio.currentTime).toBe(30)
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(audio.currentTime).toBe(0)
  })

  it('cycles the playback speed from the time label', () => {
    const { container } = render(<VoiceNote src="/a.mp3" duration={30} />)
    const audio = container.querySelector('audio') as HTMLAudioElement
    fireEvent.click(screen.getByRole('button', { name: '播放速度 1×' }))
    expect(audio.playbackRate).toBe(1.5)
    expect(screen.getByText('1.5×')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '播放速度 1.5×' }))
    expect(audio.playbackRate).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: '播放速度 2×' }))
    expect(audio.playbackRate).toBe(1)
  })

  it('rewinds when the clip ends and reports load errors', async () => {
    const onError = vi.fn()
    const onEnded = vi.fn()
    const { container } = render(<VoiceNote src="/a.mp3" duration={9} onError={onError} onEnded={onEnded} />)
    const audio = container.querySelector('audio') as HTMLAudioElement
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '播放语音' })))
    audio.currentTime = 9
    fireEvent.ended(audio)
    expect(onEnded).toHaveBeenCalled()
    expect(audio.currentTime).toBe(0)
    expect(screen.getByRole('button', { name: '播放语音' })).toBeTruthy()
    fireEvent.error(audio)
    expect(onError).toHaveBeenCalled()
  })

  it('runs on a clock when there is no file', () => {
    const { container } = render(<VoiceNote duration={9} />)
    expect(container.querySelector('audio')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '播放语音' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
  })
})
