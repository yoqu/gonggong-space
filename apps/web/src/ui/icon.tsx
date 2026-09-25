import { DRAWN_PATHS } from './icons/drawn'
import { PANE_PATHS } from './icons/pane'

const PATHS = { ...PANE_PATHS, ...DRAWN_PATHS }

export type IconName = keyof typeof PATHS
export const ICON_NAMES = Object.keys(PATHS) as IconName[]
export { LUCIDE_TO_ICON } from './icons/lucide'

export interface IconProps {
  name: IconName
  size?: number
  color?: string
  weight?: number
  label?: string
  className?: string
}

/** Pane line icon; decorative unless `label` is given. */
export function Icon({ name, size = 16, color, weight = 1.4, label, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
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
