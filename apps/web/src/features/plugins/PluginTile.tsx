import type { PluginManifest } from '@gonggong/protocol'
import { cx } from '../../lib/cx'
import { Icon } from '../../ui'
import { CATEGORY, previewUrl } from './model'
import './plugins.css'

/** The url of a plugin's own tile (`manifest.icon`), if it ships one. */
export const pluginIcon = (p: { id: string; manifest: Pick<PluginManifest, 'icon'> }) =>
  p.manifest.icon ? previewUrl(p.id, p.manifest.icon) : undefined

/** `src`: the plugin's own tile (pluginIcon); else its category's glyph. */
export function PluginTile({
  m,
  size = 32,
  src,
}: {
  m: Pick<PluginManifest, 'category'>
  size?: number
  src?: string
}) {
  if (src)
    return (
      <img
        className="plg-tile plg-tile--img"
        src={src}
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
      />
    )
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
