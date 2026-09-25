import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  Button,
  Calendar,
  CheckboxGroup,
  ColorWell,
  ComboBox,
  DatePicker,
  DropZone,
  HelpButton,
  Link,
  PullDownButton,
  SecureField,
  Stepper,
  TextArea,
  Textarea,
  TextField,
  TokenField,
} from '../src/ui'

describe('Button loading', () => {
  it('swaps the icon for a spinner, disables and marks busy', () => {
    const onClick = vi.fn()
    render(
      <Button loading icon="plus" onClick={onClick}>
        正在上传
      </Button>,
    )
    const btn = screen.getByRole('button', { name: /正在上传/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.className).toContain('ui-btn--loading')
    expect(within(btn).getByRole('progressbar', { name: '正在处理' })).toBeTruthy()
    expect(btn.querySelectorAll('svg')).toHaveLength(1)
  })
})

describe('CheckboxGroup', () => {
  it('adds and removes values in a named group', () => {
    const onChange = vi.fn()
    render(
      <CheckboxGroup
        aria-label="通知"
        defaultValue={['a']}
        onChange={onChange}
        options={[
          { value: 'a', label: '声音' },
          { value: 'b', label: '横幅' },
        ]}
      />,
    )
    const group = screen.getByRole('group', { name: '通知' })
    fireEvent.click(within(group).getByRole('checkbox', { name: '横幅' }))
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b'])
    fireEvent.click(within(group).getByRole('checkbox', { name: '声音' }))
    expect(onChange).toHaveBeenLastCalledWith(['b'])
  })
})

describe('Link', () => {
  it('opens external links in a new window and says so', () => {
    render(
      <Link href="https://example.com" external>
        在浏览器中打开
      </Link>,
    )
    const a = screen.getByRole('link', { name: /在浏览器中打开.*在新窗口打开/ })
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('HelpButton', () => {
  it('toggles a help popover and closes it on Escape', async () => {
    render(<HelpButton help="超过保留期限的消息会被移除。" />)
    const btn = screen.getByRole('button', { name: '帮助' })
    fireEvent.click(btn)
    expect(screen.getByRole('dialog', { name: '帮助' }).textContent).toContain('保留期限')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('calls onClick when there is no inline help', () => {
    const onClick = vi.fn()
    render(<HelpButton onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: '帮助' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('TextField affixes', () => {
  it('renders prefix and suffix text around the input', () => {
    render(<TextField label="单价" defaultValue="128" prefix="¥" suffix="元 / 月" />)
    const input = screen.getByRole('textbox', { name: '单价' }) as HTMLInputElement
    expect(input.value).toBe('128')
    expect(screen.getByText('元 / 月')).toBeTruthy()
    expect(screen.getByText('¥')).toBeTruthy()
  })

  it('clears with the clear button and refocuses', () => {
    const onClear = vi.fn()
    const onChange = vi.fn()
    render(<TextField label="网站" defaultValue="yoqu.dev" clearable onClear={onClear} onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: '网站' }) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(input.value).toBe('')
    expect(onClear).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull()
  })

  it('keeps controlled callers working with native change events', () => {
    const seen: string[] = []
    render(<TextField label="名称" value="a" onChange={(e) => seen.push(e.target.value)} />)
    const input = screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(seen).toEqual(['ab'])
    expect(input.value).toBe('a')
  })

  it('exposes the input through inputRef', () => {
    const ref = { current: null as HTMLInputElement | null }
    render(<TextField label="名称" inputRef={ref} />)
    expect(ref.current).toBe(screen.getByRole('textbox', { name: '名称' }))
  })
})

describe('SecureField', () => {
  it('hides the text and toggles reveal', () => {
    render(<SecureField label="密码" defaultValue="secret" />)
    const input = screen.getByLabelText('密码') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.autocomplete).toBe('current-password')
    const eye = screen.getByRole('button', { name: '显示明文' })
    fireEvent.click(eye)
    expect(input.type).toBe('text')
    expect(screen.getByRole('button', { name: '隐藏明文' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('warns when caps lock is on', () => {
    render(<SecureField label="密码" />)
    const input = screen.getByLabelText('密码')
    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true })
    expect(screen.getByText('大写锁定已打开')).toBeTruthy()
    fireEvent.blur(input)
    expect(screen.queryByText('大写锁定已打开')).toBeNull()
  })

  it('can forbid revealing', () => {
    render(<SecureField label="旧密码" revealable={false} />)
    expect(screen.queryByRole('button', { name: '显示明文' })).toBeNull()
  })
})

describe('TextArea', () => {
  it('counts characters against maxLength', () => {
    render(<TextArea label="群介绍" defaultValue="例会" maxLength={120} />)
    const box = screen.getByRole('textbox', { name: '群介绍' })
    expect(box.tagName).toBe('TEXTAREA')
    expect(screen.getByText('2 / 120')).toBeTruthy()
    fireEvent.change(box, { target: { value: '每周四例会' } })
    expect(screen.getByText('5 / 120')).toBeTruthy()
  })

  it('keeps the legacy Textarea and multiline TextField', () => {
    render(
      <>
        <Textarea aria-label="旧" rows={2} />
        <TextField label="新" multiline rows={3} />
      </>,
    )
    expect(screen.getByRole('textbox', { name: '旧' }).tagName).toBe('TEXTAREA')
    expect(screen.getByRole('textbox', { name: '新' }).tagName).toBe('TEXTAREA')
  })
})

describe('Stepper', () => {
  it('steps with arrow keys, ten at a time with Shift, clamped to the range', () => {
    const onChange = vi.fn()
    render(<Stepper label="字号" defaultValue={13} min={9} max={32} onChange={onChange} />)
    const spin = screen.getByRole('spinbutton', { name: '字号' }) as HTMLInputElement
    fireEvent.keyDown(spin, { key: 'ArrowUp' })
    expect(spin.value).toBe('14')
    fireEvent.keyDown(spin, { key: 'ArrowUp', shiftKey: true })
    expect(spin.value).toBe('24')
    fireEvent.keyDown(spin, { key: 'ArrowUp', shiftKey: true })
    expect(spin.value).toBe('32')
    expect(onChange).toHaveBeenLastCalledWith(32)
    expect((screen.getByRole('button', { name: '增加' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '减少' }))
    expect(spin.getAttribute('aria-valuenow')).toBe('31')
  })

  it('commits typed values on Enter and derives precision from step', () => {
    render(<Stepper label="行距" defaultValue={1.2} step={0.1} min={1} max={3} />)
    const spin = screen.getByRole('spinbutton', { name: '行距' }) as HTMLInputElement
    expect(spin.value).toBe('1.2')
    fireEvent.change(spin, { target: { value: '9' } })
    fireEvent.keyDown(spin, { key: 'Enter' })
    expect(spin.value).toBe('3.0')
    fireEvent.change(spin, { target: { value: 'x' } })
    fireEvent.blur(spin)
    expect(spin.value).toBe('3.0')
  })
})

describe('ComboBox', () => {
  const cities = ['北京', '上海', '深圳']

  it('filters as you type and picks with the keyboard', () => {
    const onChange = vi.fn()
    const onInput = vi.fn()
    render(<ComboBox label="所在城市" options={cities} onChange={onChange} onInput={onInput} />)
    const box = screen.getByRole('combobox', { name: '所在城市' })
    fireEvent.change(box, { target: { value: '海' } })
    expect(onInput).toHaveBeenCalledWith('海')
    const list = screen.getByRole('listbox')
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['上海'])
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('上海', { value: '上海', label: '上海' })
    expect((box as HTMLInputElement).value).toBe('上海')
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows every option from the arrow button and closes on Escape', () => {
    render(<ComboBox label="字体" options={[{ value: 'pf', label: '苹方', detail: '系统' }, '宋体']} />)
    fireEvent.click(screen.getByRole('button', { name: '显示选项' }))
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('系统')).toBeTruthy()
    const box = screen.getByRole('combobox', { name: '字体' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id)
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('TokenField', () => {
  it('commits tokens with Enter, comma and blur, ignoring duplicates', () => {
    const onChange = vi.fn()
    render(<TokenField label="收件人" defaultValue={['张三']} onChange={onChange} />)
    const input = screen.getByRole('combobox', { name: '收件人' })
    fireEvent.change(input, { target: { value: '李四' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(['张三', '李四'])
    fireEvent.change(input, { target: { value: '王五，' } })
    expect(onChange).toHaveBeenLastCalledWith(['张三', '李四', '王五'])
    fireEvent.change(input, { target: { value: '张三' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(2)
    fireEvent.change(input, { target: { value: '赵六' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(['张三', '李四', '王五', '赵六'])
  })

  it('removes the last token with Backspace and a token by its button', () => {
    const onChange = vi.fn()
    render(<TokenField label="标签" defaultValue={['设计', '评审', '周报']} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('combobox', { name: '标签' }), { key: 'Backspace' })
    expect(onChange).toHaveBeenLastCalledWith(['设计', '评审'])
    fireEvent.click(screen.getByRole('button', { name: '移除 设计' }))
    expect(onChange).toHaveBeenLastCalledWith(['评审'])
  })

  it('suggests matches and picks one with arrows', () => {
    const onChange = vi.fn()
    render(
      <TokenField
        label="成员"
        suggestions={['李思远', '李娜', { label: '产品设计组', detail: '28 人' }]}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('combobox', { name: '成员' })
    fireEvent.change(input, { target: { value: '李' } })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(['李娜'])
  })
})

describe('Calendar', () => {
  it('shows the month starting on Monday and selects with the keyboard', () => {
    const onChange = vi.fn()
    render(<Calendar defaultValue="2026-10-08" today="2026-09-25" onChange={onChange} />)
    expect(screen.getByText('2026年10月')).toBeTruthy()
    const grid = screen.getByRole('grid')
    const cells = within(grid).getAllByRole('gridcell')
    expect(cells).toHaveLength(42)
    // 2026-10-01 is a Thursday: Mon 28 Sep … Wed 30 Sep lead in.
    expect(cells[0]?.getAttribute('aria-label')).toBe('2026年9月28日 星期一')
    const sel = screen.getByRole('gridcell', { name: '2026年10月8日 星期四' })
    expect(sel.getAttribute('aria-selected')).toBe('true')
    expect(sel.tabIndex).toBe(0)
    fireEvent.keyDown(sel, { key: 'ArrowDown' })
    const next = screen.getByRole('gridcell', { name: '2026年10月15日 星期四' })
    expect(document.activeElement).toBe(next)
    fireEvent.keyDown(next, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('2026-10-15')
  })

  it('pages months and blocks dates out of range', () => {
    render(<Calendar defaultValue="2026-10-08" min="2026-10-05" today="2026-10-08" />)
    expect(
      (screen.getByRole('gridcell', { name: '2026年10月4日 星期日' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.keyDown(screen.getByRole('gridcell', { name: '2026年10月8日 星期四' }), { key: 'PageDown' })
    expect(screen.getByText('2026年11月')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '上个月' }))
    fireEvent.click(screen.getByRole('button', { name: '上个月' }))
    expect(screen.getByText('2026年9月')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '今天' }))
    expect(screen.getByText('2026年10月')).toBeTruthy()
  })
})

describe('DatePicker', () => {
  it('opens a calendar and closes after picking', async () => {
    const onChange = vi.fn()
    render(<DatePicker label="开始日期" defaultValue="2026-10-08" today="2026-10-01" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: '开始日期：2026年10月8日 星期四' })
    expect(trigger.textContent).toContain('2026年10月8日 星期四')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('gridcell', { name: '2026年10月9日 星期五' }))
    expect(onChange).toHaveBeenCalledWith('2026-10-09')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: /2026年10月9日/ })).toBeTruthy()
  })

  it('shows the placeholder when empty', () => {
    render(<DatePicker label="截止日期" placeholder="选择截止日期" />)
    expect(screen.getByRole('button', { name: '截止日期：未选择' }).textContent).toContain('选择截止日期')
  })
})

describe('ColorWell', () => {
  it('picks a swatch from the popover', async () => {
    const onChange = vi.fn()
    render(<ColorWell label="标签颜色" defaultValue="#0088ff" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '颜色：#0088ff' }))
    fireEvent.click(screen.getByRole('button', { name: '#34c759' }))
    expect(onChange).toHaveBeenCalledWith('#34c759')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('validates and applies a typed hex value', () => {
    const onChange = vi.fn()
    render(<ColorWell defaultOpen onChange={onChange} />)
    const hex = screen.getByRole('textbox', { name: '十六进制颜色' })
    fireEvent.change(hex, { target: { value: '#12' } })
    expect(screen.getByText('格式为 #RRGGBB')).toBeTruthy()
    fireEvent.change(hex, { target: { value: 'AABBCC' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('#aabbcc')
  })

  it('works as an inline radio group with arrow keys', () => {
    const onChange = vi.fn()
    render(
      <ColorWell
        inline
        aria-label="强调色"
        defaultValue="#0088ff"
        colors={['#0088ff', '#cb30e0', '#ff2d55']}
        names={['蓝色', '紫色', '粉色']}
        onChange={onChange}
      />,
    )
    const blue = screen.getByRole('radio', { name: '蓝色' })
    expect(blue.getAttribute('aria-checked')).toBe('true')
    expect(blue.tabIndex).toBe(0)
    fireEvent.keyDown(blue, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('#cb30e0')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '紫色' }))
  })
})

describe('DropZone', () => {
  it('hands chosen and dropped files over, one at a time unless multiple', () => {
    const onFiles = vi.fn()
    const { container } = render(<DropZone onFiles={onFiles} />)
    const a = new File(['a'], 'a.pdf')
    const b = new File(['b'], 'b.pdf')
    const zone = screen.getByRole('group', { name: '上传文件' })
    fireEvent.dragEnter(zone)
    expect(screen.getByText('松开以添加')).toBeTruthy()
    fireEvent.drop(zone, { dataTransfer: { files: [a, b] } })
    expect(onFiles).toHaveBeenLastCalledWith([a])
    expect(screen.getByText('将文件拖到这里')).toBeTruthy()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [b] } })
    expect(onFiles).toHaveBeenLastCalledWith([b])
    expect(screen.getByRole('button', { name: '选择文件…' })).toBeTruthy()
  })

  it('lists files with progress, done and error states', () => {
    const onRemove = vi.fn()
    render(
      <DropZone
        onRemove={onRemove}
        files={[
          { name: '报告.key', size: '42.7 MB', progress: 100 },
          { name: '设计.fig', size: '18.4 MB', progress: 46 },
          { name: '录屏.mov', error: '文件超过 200 MB，无法上传' },
        ]}
      />,
    )
    expect(screen.getByText('42.7 MB · 已上传')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: '设计.fig 上传进度' }).getAttribute('aria-valuenow')).toBe(
      '46',
    )
    expect(screen.getByText('文件超过 200 MB，无法上传')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '移除 录屏.mov' }))
    expect(onRemove).toHaveBeenCalledWith(2, { name: '录屏.mov', error: '文件超过 200 MB，无法上传' })
  })
})

describe('PullDownButton', () => {
  const items = [
    { label: '群组', value: 'group', shortcut: '⌘N' },
    { label: '会议', value: 'meet' },
  ]

  it('opens a menu, runs an action and returns focus', async () => {
    const onSelect = vi.fn()
    render(<PullDownButton label="新建" icon="plus" items={items} onSelect={onSelect} />)
    const btn = screen.getByRole('button', { name: '新建' })
    expect(btn.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(btn)
    fireEvent.click(screen.getByRole('menuitem', { name: /会议/ }))
    expect(onSelect).toHaveBeenCalledWith('meet')
    expect(document.activeElement).toBe(btn)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('opens from the keyboard and closes on Escape', async () => {
    render(<PullDownButton icon="more" aria-label="更多操作" items={items} />)
    const btn = screen.getByRole('button', { name: '更多操作' })
    fireEvent.keyDown(btn, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /群组/ }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(document.activeElement).toBe(btn)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('portals a fixed menu that closes on scroll, without the ▾ when asked', async () => {
    const onSelect = vi.fn()
    render(
      <div data-testid="clip" style={{ overflow: 'auto' }}>
        <PullDownButton
          icon="more"
          aria-label="操作"
          portal
          indicator={false}
          items={items}
          onSelect={onSelect}
        />
      </div>,
    )
    const btn = screen.getByRole('button', { name: '操作' })
    expect(btn.querySelector('.ui-pulldown__chev')).toBeNull()
    fireEvent.click(btn)
    const menu = screen.getByRole('menu')
    expect(screen.getByTestId('clip').contains(menu)).toBe(false)
    expect(menu.style.top).not.toBe('')
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: /会议/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /会议/ }))
    expect(onSelect).toHaveBeenCalledWith('meet')
    fireEvent.click(btn)
    fireEvent.scroll(screen.getByTestId('clip'))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})
