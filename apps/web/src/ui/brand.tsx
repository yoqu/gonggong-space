import { useId } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import './brand.css'

/**
 * 共工空间 mark: two wave crests (the oracle-bone 共 is two hands raising one object) lift a jade above the water.
 * `motion="enter"` draws it in once; `"idle"` also keeps the jade floating and the water flowing (splash screens).
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
  const id = useId()
  return (
    <svg
      className={cx('ui-logo', motion && `ui-logo--${motion}`, className)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}g`} x1="8" y1="4" x2="56" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2F6BFF" />
          <stop offset="1" stopColor="#0FA3A0" />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <rect width="64" height="64" rx="15" />
        </clipPath>
      </defs>
      <rect className="ui-logo__badge" width="64" height="64" rx="15" fill={`url(#${id}g)`} />
      <g clipPath={`url(#${id}c)`}>
        <path
          className="ui-logo__water"
          d="M-9 53c4.6 0 4.6-3 9.2-3s4.6 3 9.2 3 4.6-3 9.2-3 4.6 3 9.2 3 4.6-3 9.2-3 4.6 3 9.2 3 4.6-3 9.2-3 4.6 3 9.2 3 4.6-3 9.2-3"
        />
      </g>
      <path className="ui-logo__hand" pathLength={1} d="M9 44c5 0 7-4 9-9 3-7 7-8 10-5 2 2 1 6-2 6" />
      <path className="ui-logo__hand" pathLength={1} d="M55 44c-5 0-7-4-9-9-3-7-7-8-10-5-2 2-1 6 2 6" />
      <path className="ui-logo__jade" d="M32 11 40 19 32 27 24 19Z" />
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
