import { BRAND_PATHS } from './icons/brand'
import { DRAWN_PATHS } from './icons/drawn'
import { PANE_PATHS } from './icons/pane'

const PATHS = { ...PANE_PATHS, ...DRAWN_PATHS, ...BRAND_PATHS }

export type IconName = keyof typeof PATHS
export const ICON_NAMES = Object.keys(PATHS) as IconName[]

export interface IconProps {
  name: IconName
  size?: number
  color?: string
  weight?: number
  label?: string
  className?: string
}

/** Pane line icon (brand marks are filled); decorative unless `label` is given. */
export function Icon({ name, size = 16, color, weight = 1.4, label, className }: IconProps) {
  const brand = name in BRAND_PATHS
  return (
    <svg
      viewBox={brand ? '0 0 24 24' : '0 0 18 18'}
      width={size}
      height={size}
      fill={brand ? 'currentColor' : 'none'}
      stroke={brand ? 'none' : 'currentColor'}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={color ? { color } : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
