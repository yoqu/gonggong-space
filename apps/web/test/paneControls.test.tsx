import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Checkbox,
  PopUpButton,
  ProgressIndicator,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Slider,
  Switch,
  Tag,
  TextField,
} from '../src/ui'

describe('Button', () => {
  it('renders an icon-only button as a circle named by aria-label', () => {
    render(<Button icon="plus" aria-label="添加" />)
    const btn = screen.getByRole('button', { name: '添加' })
    expect(btn.className).toContain('ui-btn--icon')
    expect(btn.querySelector('svg')).toBeTruthy()
  })

  it('requires aria-label when there is no text', () => {
    // @ts-expect-error icon-only buttons must be named
    render(<Button icon="plus" />)
  })

  it('maps variant and size to classes, regular being the default', () => {
    render(
      <Button variant="primary" size="xlarge">
        继续
      </Button>,
    )
    const btn = screen.getByRole('button', { name: '继续' })
    expect(btn.className).toBe('ui-btn ui-btn--primary ui-btn--xlarge')
  })
})

describe('Switch', () => {
  it('toggles uncontrolled and exposes switch semantics', () => {
    const onChange = vi.fn()
    render(<Switch aria-label="Wi-Fi" defaultChecked onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: 'Wi-Fi' }) as HTMLInputElement
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(false)
    expect(sw.checked).toBe(false)
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('stays put when controlled and not updated', () => {
    render(<Switch aria-label="蓝牙" checked={false} onChange={() => {}} />)
    const sw = screen.getByRole('switch', { name: '蓝牙' }) as HTMLInputElement
    fireEvent.click(sw)
    expect(sw.checked).toBe(false)
  })

  it('names itself by a visible label', () => {
    render(<Switch label="自动更新" labelPosition="after" defaultChecked />)
    expect(screen.getByRole('switch', { name: '自动更新' })).toBeTruthy()
  })
})

describe('Checkbox', () => {
  it('marks the input indeterminate and shows a dash', () => {
    const { container, rerender } = render(<Checkbox label="全部" indeterminate />)
    const box = screen.getByRole('checkbox', { name: '全部' }) as HTMLInputElement
    expect(box.indeterminate).toBe(true)
    expect(container.querySelector('.ui-check--mixed')).toBeTruthy()
    rerender(<Checkbox label="全部" />)
    expect(box.indeterminate).toBe(false)
  })
})

describe('RadioGroup', () => {
  it('selects one option at a time', () => {
    const onChange = vi.fn()
    render(
      <RadioGroup
        aria-label="新窗口打开"
        defaultValue="home"
        onChange={onChange}
        options={[
          { value: 'home', label: '个人文件夹' },
          { value: 'desktop', label: '桌面' },
        ]}
      />,
    )
    expect((screen.getByRole('radio', { name: '个人文件夹' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '桌面' }))
    expect(onChange).toHaveBeenCalledWith('desktop')
    expect((screen.getByRole('radio', { name: '个人文件夹' }) as HTMLInputElement).checked).toBe(false)
  })
})

describe('TextField', () => {
  it('links label and error, marking the input invalid', () => {
    render(<TextField label="电子邮件" error="请输入有效的电子邮件地址" />)
    const input = screen.getByRole('textbox', { name: '电子邮件' })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('请输入有效的电子邮件地址').id).toBe(input.getAttribute('aria-describedby'))
  })

  it('renders a textarea when multiline', () => {
    render(<TextField multiline label="系统提示词" rows={3} />)
    expect(screen.getByRole('textbox', { name: '系统提示词' }).tagName).toBe('TEXTAREA')
  })
})

describe('SearchField', () => {
  it('clears the text and submits on Enter', () => {
    const onSubmit = vi.fn()
    render(<SearchField defaultValue="季度报告" onSubmit={onSubmit} />)
    const box = screen.getByRole('searchbox', { name: '搜索' }) as HTMLInputElement
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('季度报告')
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(box.value).toBe('')
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull()
  })
})

describe('SegmentedControl', () => {
  const items = [
    { value: 'd', label: '日' },
    { value: 'w', label: '周' },
    { value: 'm', label: '月' },
  ]
  const checked = (name: string) => screen.getByRole('radio', { name }).getAttribute('aria-checked')

  it('selects on click and reads as a radio group', () => {
    const onChange = vi.fn()
    render(<SegmentedControl aria-label="时间范围" items={items} defaultValue="w" onChange={onChange} />)
    expect(screen.getByRole('radiogroup', { name: '时间范围' })).toBeTruthy()
    expect(checked('周')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '月' }))
    expect(onChange).toHaveBeenCalledWith('m')
    expect(checked('月')).toBe('true')
    expect(checked('周')).toBe('false')
  })

  it('is one tab stop; arrows, Home and End move selection and focus, stopping at the ends', () => {
    function Harness() {
      const [v, setV] = useState('d')
      return <SegmentedControl aria-label="时间范围" items={items} value={v} onChange={setV} />
    }
    render(<Harness />)
    const day = screen.getByRole('radio', { name: '日' })
    expect(day.tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: '周' }).tabIndex).toBe(-1)
    fireEvent.keyDown(day, { key: 'ArrowLeft' })
    expect(checked('日')).toBe('true')
    fireEvent.keyDown(day, { key: 'ArrowRight' })
    const week = screen.getByRole('radio', { name: '周' })
    expect(checked('周')).toBe('true')
    expect(document.activeElement).toBe(week)
    fireEvent.keyDown(week, { key: 'End' })
    const month = screen.getByRole('radio', { name: '月' })
    expect(checked('月')).toBe('true')
    expect(document.activeElement).toBe(month)
    fireEvent.keyDown(month, { key: 'Home' })
    expect(checked('日')).toBe('true')
  })

  it('names icon-only segments', () => {
    render(
      <SegmentedControl
        aria-label="显示方式"
        items={[
          { value: 'grid', icon: 'grid', 'aria-label': '图标' },
          { value: 'list', icon: 'list', 'aria-label': '列表' },
        ]}
      />,
    )
    expect(screen.getByRole('radiogroup', { name: '显示方式' })).toBeTruthy()
    expect(checked('图标')).toBe('true')
  })
})

describe('PopUpButton', () => {
  const options = [
    { value: 'name', label: '名称' },
    { value: 'kind', label: '种类' },
    { value: 'date', label: '修改日期' },
  ]
  const highlighted = (menu: HTMLElement) =>
    document.getElementById(menu.getAttribute('aria-activedescendant') ?? '')?.textContent

  it('opens a checked menu highlighting the current value and selects another', async () => {
    const onChange = vi.fn()
    render(<PopUpButton options={options} defaultValue="name" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: '名称' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(menu)
    expect(highlighted(menu)).toBe('名称')
    expect(screen.getByRole('menuitemcheckbox', { name: '名称' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '种类' }))
    expect(onChange).toHaveBeenCalledWith('kind')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '种类' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('closes on Escape without changing the value', async () => {
    const onChange = vi.fn()
    render(<PopUpButton options={options} defaultValue="name" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '名称' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves with arrows, Home/End and typing, then picks with Enter', () => {
    const onChange = vi.fn()
    render(<PopUpButton options={options} defaultValue="name" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '名称' }), { key: 'ArrowDown' })
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(highlighted(menu)).toBe('种类')
    fireEvent.keyDown(menu, { key: 'End' })
    expect(highlighted(menu)).toBe('修改日期')
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(highlighted(menu)).toBe('名称')
    fireEvent.keyDown(menu, { key: '种' })
    expect(highlighted(menu)).toBe('种类')
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('kind')
  })

  it('portals the menu out of a clipping ancestor such as a dialog body', () => {
    render(
      <div data-testid="clip" style={{ overflow: 'auto', height: 40 }}>
        <PopUpButton options={options} defaultValue="name" />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '名称' }))
    const menu = screen.getByRole('menu')
    expect(screen.getByTestId('clip').contains(menu)).toBe(false)
    expect(menu.classList.contains('ui-float--fixed')).toBe(true)
  })

  it('shows the placeholder when nothing is selected', () => {
    render(<PopUpButton options={options} value={null} placeholder="请选择" />)
    expect(screen.getByRole('button', { name: '请选择' })).toBeTruthy()
  })
})

describe('Avatar', () => {
  const text = (el: HTMLElement) => el.textContent
  it('uses the last two characters of a Chinese person name', () => {
    render(<Avatar name="李思远" />)
    expect(text(screen.getByRole('img', { name: '李思远' }))).toBe('思远')
  })

  it('uses the first two characters of a Chinese name longer than a person name', () => {
    render(<Avatar name="系统管理员" />)
    expect(text(screen.getByRole('img', { name: '系统管理员' }))).toBe('系统')
  })

  it('uses the first two characters of a group name', () => {
    render(<Avatar name="产品设计组" shape="square" />)
    expect(text(screen.getByRole('img', { name: '产品设计组' }))).toBe('产品')
  })

  it('uses initials of an English name', () => {
    render(<Avatar name="Mia Chen" />)
    expect(text(screen.getByRole('img', { name: 'Mia Chen' }))).toBe('MC')
  })

  it('uses word initials when a mixed name has a lone Chinese character', () => {
    render(<Avatar name="yoqu的 Codex" shape="square" />)
    expect(text(screen.getByRole('img', { name: 'yoqu的 Codex' }))).toBe('YC')
  })

  it('hashes the name to a stable avatar color', () => {
    const fill = () => (container.querySelector('.ui-avatar__art > rect') as SVGRectElement).style.fill
    const { container, rerender } = render(<Avatar name="张三" />)
    const first = fill()
    expect(first).toMatch(/^var\(--avatar-[1-6]\)$/)
    rerender(<Avatar name="张三" size={40} />)
    expect(fill()).toBe(first)
  })

  it('announces presence status', () => {
    render(<Avatar name="张三" status="online" />)
    expect(screen.getByRole('img', { name: '张三（在线）' })).toBeTruthy()
  })

  it('stacks a group with an overflow count', () => {
    render(
      <AvatarGroup
        people={[{ name: '张三' }, { name: '李四' }, { name: '王五' }, { name: '赵六' }]}
        max={3}
      />,
    )
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.getByText('+1')).toBeTruthy()
  })
})

describe('Badge and Tag', () => {
  it('caps the count at 99+', () => {
    render(<Badge count={128} />)
    expect(screen.getByLabelText('128 条未读').textContent).toBe('99+')
  })

  it('renders nothing for zero', () => {
    const { container } = render(<Badge count={0} />)
    expect(container.innerHTML).toBe('')
  })

  it('marks muted badges', () => {
    render(<Badge count={12} muted />)
    expect(screen.getByText('12').className).toContain('ui-badge--muted')
  })

  it('renders a solid-red tag with an icon', () => {
    render(
      <Tag tone="solid-red" icon="bolt">
        加急
      </Tag>,
    )
    const tag = screen.getByText('加急')
    expect(tag.className).toBe('ui-tag ui-tag--solid-red')
    expect(tag.querySelector('svg')).toBeTruthy()
  })
})

describe('ProgressIndicator and Slider', () => {
  it('reports determinate progress and omits the value when indeterminate', () => {
    render(
      <>
        <ProgressIndicator value={64} aria-label="下载进度" />
        <ProgressIndicator aria-label="正在准备" />
      </>,
    )
    expect(screen.getByRole('progressbar', { name: '下载进度' }).getAttribute('aria-valuenow')).toBe('64')
    const indet = screen.getByRole('progressbar', { name: '正在准备' })
    expect(indet.getAttribute('aria-valuenow')).toBeNull()
    expect(indet.className).toContain('ui-progress--indeterminate')
  })

  it('updates the slider fill as the value changes', () => {
    const onChange = vi.fn()
    const { container } = render(<Slider aria-label="音量" defaultValue={50} onChange={onChange} />)
    fireEvent.change(screen.getByRole('slider', { name: '音量' }), { target: { value: '80' } })
    expect(onChange).toHaveBeenCalledWith(80)
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--ui-fill')).toBe('80%')
  })
})
