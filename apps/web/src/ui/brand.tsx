import { t } from '../i18n'
import { cx } from '../lib/cx'
import './brand.css'

// Paths come from docs/brand/logo (gg-symbol.svg, gg-symbol-small.svg); the small cut has thicker rings and no pupils.
const MARK = {
  full: [
    'M18 95A52 52 0 1 1 122 95A52 52 0 1 1 18 95ZM46 95A24 24 0 1 0 94 95A24 24 0 1 0 46 95ZM94 57A14 14 0 0 1 122 57V161A52 52 0 0 1 70 213H52A14 14 0 0 1 52 185H70A24 24 0 0 0 94 161Z',
    'M134 95A52 52 0 1 1 238 95A52 52 0 1 1 134 95ZM162 95A24 24 0 1 0 210 95A24 24 0 1 0 162 95ZM210 57A14 14 0 0 1 238 57V161A52 52 0 0 1 186 213H168A14 14 0 0 1 168 185H186A24 24 0 0 0 210 161Z',
  ],
  small: [
    'M14 95A52 52 0 1 1 118 95A52 52 0 1 1 14 95ZM39 95A27 27 0 1 0 93 95A27 27 0 1 0 39 95ZM93 57A12.5 12.5 0 0 1 118 57V161A52 52 0 0 1 66 213H48A12.5 12.5 0 0 1 48 188H66A27 27 0 0 0 93 161Z',
    'M138 95A52 52 0 1 1 242 95A52 52 0 1 1 138 95ZM163 95A27 27 0 1 0 217 95A27 27 0 1 0 163 95ZM217 57A12.5 12.5 0 0 1 242 57V161A52 52 0 0 1 190 213H172A12.5 12.5 0 0 1 172 188H190A27 27 0 0 0 217 161Z',
  ],
}

/**
 * 共工空间 mark「对眼 gg」: two g's side by side, a pair of partners that are also a pair of eyes.
 * Below 32px the pupils blur the rings shut, so the small cut drops them (brand guideline).
 * `motion="enter"` pops the two g's in once; `"idle"` also keeps the pupils glancing around (splash screens).
 */
export function Logo({
  size = 24,
  motion,
  className,
}: {
  size?: number
  motion?: 'enter' | 'idle'
  className?: string
}) {
  const small = size < 32
  const [blue, amber] = small ? MARK.small : MARK.full
  return (
    <svg
      className={cx('ui-logo', motion && `ui-logo--${motion}`, className)}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden="true"
    >
      <path className="ui-logo__g ui-logo__g--blue" d={blue} />
      <path className="ui-logo__g ui-logo__g--amber" d={amber} />
      {small ? null : (
        <>
          <circle className="ui-logo__pupil" cx="75" cy="99" r="11" />
          <circle className="ui-logo__pupil" cx="191" cy="99" r="11" />
        </>
      )}
    </svg>
  )
}

/** Logo + product name, the one brand lockup used by the top bar, admin console and auth screens. */
export function Brand({
  size = 24,
  motion,
  subtitle,
}: {
  size?: number
  motion?: 'enter'
  subtitle?: string
}) {
  return (
    <span className="ui-brand" style={{ ['--brand-size' as string]: `${size}px` }}>
      <Logo size={size} motion={motion} />
      <span className="ui-brand__text">
        <span className="ui-brand__name">{t('共工空间')}</span>
        {subtitle ? <span className="ui-brand__sub">{subtitle}</span> : null}
      </span>
    </span>
  )
}
