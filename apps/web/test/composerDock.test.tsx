import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { FloatingChat } from '../src/app/floatingChat'
import { ComposerDock } from '../src/features/chat/ComposerDock'

const dock = (floating: boolean) => (
  <FloatingChat.Provider value={floating}>
    <ComposerDock>
      <textarea aria-label="输入" />
    </ComposerDock>
  </FloatingChat.Provider>
)

beforeEach(() => localStorage.clear())

describe('composer dock', () => {
  it('stays in the chat column with no controls when not floating', () => {
    render(dock(false))
    expect(screen.getByRole('textbox', { name: '输入' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '收起输入框' })).toBeNull()
  })

  it('floats, hides into the orb and grows back, with ⌘J too, remembering the choice', () => {
    const { rerender, unmount } = render(dock(true))
    const box = screen.getByRole('textbox', { name: '输入' }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '收起输入框' }))
    expect(screen.getByRole('button', { name: '展开输入框' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '输入' })).toBeNull()
    expect(localStorage.getItem('gg.composerDock.hidden')).toBe('1')
    fireEvent.keyDown(window, { key: 'j', metaKey: true })
    expect(screen.queryByRole('button', { name: '展开输入框' })).toBeNull()
    // The same composer instance: the draft survived.
    expect((screen.getByRole('textbox', { name: '输入' }) as HTMLTextAreaElement).value).toBe('草稿')
    fireEvent.click(screen.getByRole('button', { name: '收起输入框' }))
    // Leaving 全屏 puts it back in the chat, whatever the floating state.
    rerender(dock(false))
    expect(screen.getByRole('textbox', { name: '输入' })).toBeTruthy()
    unmount()
    render(dock(true))
    expect(screen.getByRole('button', { name: '展开输入框' })).toBeTruthy()
  })
})
