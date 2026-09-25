import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
  Drawer,
  Select,
  StepIndicator,
  Switch,
  Tabs,
  Toaster,
  toast,
  useToasts,
} from '../src/ui'

afterEach(() => {
  vi.useRealTimers()
  useToasts.setState({ items: [] })
})

describe('Button', () => {
  it('fires onClick unless disabled', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>发送</Button>)
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(onClick).toHaveBeenCalledOnce()
    rerender(
      <Button onClick={onClick} disabled>
        发送
      </Button>,
    )
    const btn = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('Tabs', () => {
  it('reports the selected value and skips disabled items', () => {
    const onChange = vi.fn()
    render(
      <Tabs
        value="a"
        onChange={onChange}
        items={[
          { value: 'a', label: '过程' },
          { value: 'b', label: '改动' },
          { value: 'c', label: '审计', disabled: true },
        ]}
      />,
    )
    expect(screen.getByRole('tab', { name: '过程' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: '改动' }))
    fireEvent.click(screen.getByRole('tab', { name: '审计' }))
    expect(onChange.mock.calls).toEqual([['b']])
  })
})

describe('Switch and Checkbox', () => {
  it('toggles a controlled switch', () => {
    function Harness() {
      const [on, setOn] = useState(false)
      return <Switch label="消息免打扰" checked={on} onChange={setOn} />
    }
    render(<Harness />)
    const sw = screen.getByRole('switch', { name: '消息免打扰' }) as HTMLInputElement
    expect(sw.checked).toBe(false)
    fireEvent.click(sw)
    expect(sw.checked).toBe(true)
  })

  it('reports checkbox changes with its label', () => {
    const onChange = vi.fn()
    render(<Checkbox label="设为群管理员" checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('设为群管理员'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Select', () => {
  it('opens the list and picks an option', async () => {
    const onChange = vi.fn()
    render(
      <Select
        value="claude"
        onChange={onChange}
        options={[
          { value: 'claude', label: 'Claude Code' },
          { value: 'codex', label: 'Codex' },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Codex' }))
    expect(onChange).toHaveBeenCalledWith('codex')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

describe('Dialog and Drawer', () => {
  it('closes a dialog on Escape and on overlay click', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="绑定新机器" onClose={onClose}>
        内容
      </Dialog>,
    )
    expect(screen.getByRole('dialog', { name: '绑定新机器' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    fireEvent.click(screen.getByText('内容'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} title="x" onClose={() => {}}>
        内容
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes a drawer on Escape', () => {
    const onClose = vi.fn()
    render(
      <Drawer open title="群设置" onClose={onClose}>
        设置
      </Drawer>,
    )
    expect(screen.getByRole('dialog', { name: '群设置' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('display components', () => {
  it('Avatar shows a Chinese name in full when it is two characters', () => {
    render(<Avatar name="王磊" />)
    expect(screen.getByText('王磊')).toBeTruthy()
  })

  it('StepIndicator exposes each step status', () => {
    render(
      <StepIndicator
        steps={[
          { label: '生成绑定码', status: 'completed' },
          { label: '本机登录', status: 'active' },
          { label: '完成', status: 'pending' },
        ]}
      />,
    )
    expect(screen.getByText('本机登录').closest('li')?.dataset.status).toBe('active')
  })
})

describe('Toast', () => {
  it('shows toasts and auto-dismisses them', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => {
      toast({ type: 'success', title: '已保存', message: '设置已更新' })
    })
    expect(screen.getByText('已保存')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByText('已保存')).toBeNull()
  })

  it('closes a toast manually', async () => {
    render(<Toaster />)
    act(() => {
      toast({ type: 'error', message: '发送失败' })
    })
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByText('发送失败')).toBeNull())
  })
})
