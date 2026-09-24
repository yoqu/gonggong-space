import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, Dialog, Drawer, Input, Select, Tabs, Toaster, toast, useToasts } from '../src/ui'

afterEach(() => {
  vi.useRealTimers()
  useToasts.setState({ items: [] })
})

const esc = (init: Partial<KeyboardEventInit> & { keyCode?: number } = {}) =>
  fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape', ...init })

function FormDialog({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>打开</Button>
      <Dialog
        open={open}
        title="新建群"
        closeOnBackdrop={false}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
        footer={<Button>创建</Button>}
      >
        <Input aria-label="名称" />
        <Input aria-label="描述" />
      </Dialog>
    </>
  )
}

describe('Dialog focus management', () => {
  it('focuses the first field, traps Tab, and restores focus to the trigger', async () => {
    render(<FormDialog />)
    const trigger = screen.getByRole('button', { name: '打开' })
    trigger.focus()
    fireEvent.click(trigger)
    const name = screen.getByLabelText('名称')
    expect(document.activeElement).toBe(name)

    const create = screen.getByRole('button', { name: '创建' })
    create.focus()
    fireEvent.keyDown(create, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(create)

    esc()
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps a form dialog open on backdrop click when closeOnBackdrop is false', () => {
    const onClose = vi.fn()
    render(<FormDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('Escape stack', () => {
  it('closes only the topmost overlay and ignores IME composition', () => {
    const closeDrawer = vi.fn()
    const closeDialog = vi.fn()
    render(
      <Drawer open title="群设置" onClose={closeDrawer}>
        <Dialog open title="确认" onClose={closeDialog}>
          内容
        </Dialog>
      </Drawer>,
    )
    esc({ isComposing: true })
    esc({ keyCode: 229 })
    expect(closeDialog).not.toHaveBeenCalled()
    esc()
    expect(closeDialog).toHaveBeenCalledOnce()
    expect(closeDrawer).not.toHaveBeenCalled()
  })
})

describe('Select keyboard', () => {
  function Harness({ onChange }: { onChange: (v: string) => void }) {
    const [v, setV] = useState('a')
    return (
      <Select
        label="agent"
        value={v}
        onChange={(x) => {
          onChange(x)
          setV(x)
        }}
        options={[
          { value: 'a', label: 'Claude Code' },
          { value: 'b', label: 'Codex', disabled: true },
          { value: 'c', label: 'Gemini' },
        ]}
      />
    )
  }

  it('opens with ArrowDown, skips disabled options, selects with Enter and closes with Escape', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'agent' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const list = screen.getByRole('listbox')
    expect(document.activeElement).toBe(list)
    const active = () => document.getElementById(list.getAttribute('aria-activedescendant')!)
    expect(active()?.textContent).toBe('Claude Code')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(active()?.textContent).toBe('Gemini')
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('c')
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'Gemini' }).getAttribute('aria-selected')).toBe('true')
    esc()
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('closes the list, not the dialog, on Escape', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="新建 Bot" onClose={onClose}>
        <Harness onChange={() => {}} />
      </Dialog>,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'agent' }), { key: 'ArrowDown' })
    esc()
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Tabs keyboard', () => {
  it('uses a roving tabindex and moves with arrow keys, skipping disabled tabs', () => {
    function Harness() {
      const [v, setV] = useState('a')
      return (
        <Tabs
          value={v}
          onChange={setV}
          items={[
            { value: 'a', label: '过程' },
            { value: 'b', label: '改动', disabled: true },
            { value: 'c', label: '审计' },
          ]}
        />
      )
    }
    render(<Harness />)
    const tab = (name: string) => screen.getByRole('tab', { name })
    expect([tab('过程').tabIndex, tab('审计').tabIndex]).toEqual([0, -1])
    fireEvent.keyDown(tab('过程'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('审计'))
    expect(tab('审计').getAttribute('aria-selected')).toBe('true')
    expect(tab('审计').tabIndex).toBe(0)
    fireEvent.keyDown(tab('审计'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('过程'))
    fireEvent.keyDown(tab('过程'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tab('审计'))
  })
})

describe('Toast behavior', () => {
  it('keeps errors until dismissed and announces them as alerts', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => {
      toast({ type: 'error', message: '发送失败' })
    })
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(screen.getByRole('alert').textContent).toContain('发送失败')
  })

  it('pauses auto-dismiss on hover', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => {
      toast({ type: 'success', message: '已保存' })
    })
    fireEvent.mouseEnter(screen.getByRole('status'))
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByText('已保存')).toBeTruthy()
    fireEvent.mouseLeave(screen.getByRole('status'))
    act(() => {
      vi.advanceTimersByTime(4_100)
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByText('已保存')).toBeNull()
  })

  it('merges identical toasts into one with a count', () => {
    render(<Toaster />)
    act(() => {
      toast({ type: 'error', title: '加载失败', message: '网络连接失败，请检查网络后重试' })
      toast({ type: 'error', title: '加载失败', message: '网络连接失败，请检查网络后重试' })
      toast({ type: 'error', title: '加载失败', message: '另一个错误' })
    })
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByText('×2')).toBeTruthy()
  })
})
