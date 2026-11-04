import type { PluginManifest } from '@gonggong/protocol'
import { cx } from '../../lib/cx'
import { Icon } from '../../ui'
import { CATEGORY } from './model'
import { hasOfficialIcon, OfficialIcon } from './OfficialIcon'
import './plugins.css'

/** `official`: the manifest name of a platform plugin, drawn with its own tile when it has one. */
export function PluginTile({
  m,
  size = 32,
  official,
}: {
  m: Pick<PluginManifest, 'category'>
  size?: number
  official?: string
}) {
  if (official && hasOfficialIcon(official)) return <OfficialIcon name={official} size={size} />
  const c = CATEGORY[m.category]
  return (
    <span className="plg-tile" style={{ background: c.color, width: size, height: size }} aria-hidden="true">
      <Icon name={c.icon} size={Math.round(size * 0.5)} />
    </span>
  )
}

export function Swatches({ colors, className }: { colors: string[]; className?: string }) {
  return (
    <span className={cx('plg-swatch', className)} aria-hidden="true">
      {colors.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: colours may repeat
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  )
}
