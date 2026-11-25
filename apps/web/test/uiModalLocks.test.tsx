import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarEditor, ConfirmActionDialog, useToasts } from '../src/ui'
import { mockCrop, png } from './crop'

beforeEach(() => {
  localStorage.setItem('gg.locale', 'zh')
  mockCrop()
})
afterEach(() => {
  useToasts.setState({ items: [] })
})

describe('ui modal locks', () => {
  it('ConfirmActionDialog clears stale error as soon as retry starts', async () => {
    let attempt = 0
    let resolveSecond!: () => void
    const run = vi.fn(() => {
      attempt++
      if (attempt === 1) return Promise.reject(new Error('首次失败'))
      return new Promise<void>((r) => {
        resolveSecond = r
      })
    })
    const onClose = vi.fn()
    render(
      <ConfirmActionDialog
        title="确认删除？"
        message="操作不可撤销"
        consequences={['将立即生效']}
        label="删除"
        done="已删除"
        run={run}
        onClose={onClose}
      />,
    )
    const dialog = screen.getByRole('alertdialog')
    const confirmBtn = within(dialog).getByRole('button', { name: '删除' }) as HTMLButtonElement

    fireEvent.click(confirmBtn)
    expect(await within(dialog).findByText('首次失败')).toBeTruthy()

    // Retrying clears the previous error immediately before the second call resolves.
    fireEvent.click(confirmBtn)
    expect(within(dialog).queryByText('首次失败')).toBeNull()
    expect(confirmBtn.getAttribute('aria-busy')).toBe('true')

    await act(async () => {
      resolveSecond()
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('AvatarCropDialog locks Cancel, Escape, and double-submit with loading state while uploading', async () => {
    let resolveUpload!: () => void
    const onUpload = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveUpload = r
        }),
    )
    render(<AvatarEditor name="王磊" onUpload={onUpload} />)
    fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [png()] } })
    const dialog = screen.getByRole('dialog', { name: '编辑头像' })
    const img = document.querySelector('.ui-avatar-crop__view img') as HTMLImageElement
    Object.defineProperty(img, 'naturalWidth', { value: 200 })
    Object.defineProperty(img, 'naturalHeight', { value: 200 })
    fireEvent.load(img)

    const saveBtn = within(dialog).getByRole('button', { name: '完成' }) as HTMLButtonElement
    const cancelBtn = within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement
    fireEvent.click(saveBtn)

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect(saveBtn.disabled).toBe(true)
    expect(saveBtn.getAttribute('aria-busy')).toBe('true')
    expect(cancelBtn.disabled).toBe(true)

    // Double-submit, Cancel click, and Escape must all be ignored while busy.
    fireEvent.click(saveBtn)
    fireEvent.click(cancelBtn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: '编辑头像' })).toBeTruthy()

    await act(async () => {
      resolveUpload()
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑头像' })).toBeNull())
  })
})
