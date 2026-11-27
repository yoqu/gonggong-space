import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { CanvasSettings, LayersPanel } from './Inspector'

const settings = () =>
  render(
    <CanvasSettings
      page={null}
      selection={null}
      readOnly={false}
      colors={[]}
      screens={3}
      device="mobile"
      systemName={null}
      favourites={[]}
      showLinks={false}
      showBadges={false}
      rulers={false}
      onDesign={() => {}}
      onPick={() => {}}
      onLinks={() => {}}
      onBadges={() => {}}
      onRulers={() => {}}
    />,
  )

it('names the canvas’s pages 页面 throughout 画布设置, and no removed tool', () => {
  const { container } = settings()
  const text = container.textContent ?? ''
  expect(text).not.toContain('屏幕')
  expect(text).not.toContain('直接编辑')
  expect(text).toContain('页面')
  expect(text).toContain('选中页面按 ⇧F 收藏')
})

it('names pages 页面 in 图层 too', () => {
  const { container } = render(
    <LayersPanel screen={undefined} items={null} selected={null} onPick={() => {}} onRefresh={() => {}} />,
  )
  expect(container.textContent).not.toContain('屏幕')
  expect(screen.getByText('先选中一个页面')).toBeTruthy()
})
