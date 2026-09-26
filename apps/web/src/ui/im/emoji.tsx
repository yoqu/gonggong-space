import { cx } from '../../lib/cx'
import './emoji.css'

// Twemoji graphics by Twitter, Inc. and other contributors (https://github.com/jdecked/twemoji v17.0.3), licensed
// under CC-BY 4.0 (./twemoji/LICENSE-GRAPHICS). Bundled locally for offline LAN use; each file is fetched on first use.
const URLS = import.meta.glob<string>('./twemoji/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
})

/** Twemoji file name: code points in hex; FE0F is dropped unless the sequence has a ZWJ. */
const file = (e: string) =>
  [...(e.includes('‍') ? e : e.replace(/️/g, ''))].map((c) => c.codePointAt(0)?.toString(16)).join('-')

/** An emoji drawn from the bundled Twemoji set so it looks the same on every OS; the char stays as alt text. */
export function Emoji({ char, className }: { char: string; className?: string }) {
  const src = URLS[`./twemoji/${file(char)}.svg`]
  return src ? (
    <img className={cx('pn-emoji-glyph', className)} src={src} alt={char} draggable={false} />
  ) : (
    char
  )
}
