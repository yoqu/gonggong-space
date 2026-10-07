import { m, useAnimationControls } from 'motion/react'
import { type FormEvent, type ReactNode, useEffect } from 'react'
import { Button, Icon, Logo, Spinner } from '../../ui'
import { AuthStage, type AuthVariant, LocaleToggle, ThemeToggle } from './AuthStage'
import './auth.css'

/**
 * Split auth screen shared by login, sign-up and the forced password change: the stage on the left,
 * the form on the right. `errorKey` changes on every failed submit so the form shakes once per failure.
 */
export function AuthCard({
  title,
  subtitle,
  testId,
  variant,
  errorKey,
  leaving,
  onSubmit,
  children,
  footer,
}: {
  title: string
  subtitle: string
  testId?: string
  variant: AuthVariant
  errorKey?: number
  leaving?: boolean
  onSubmit: (e: FormEvent) => void
  children: ReactNode
  footer?: ReactNode
}) {
  const shake = useAnimationControls()
  useEffect(() => {
    if (errorKey) void shake.start({ x: [0, -10, 9, -6, 4, 0], transition: { duration: 0.42 } })
  }, [errorKey, shake])

  return (
    <div className="auth" data-testid={testId} data-leaving={leaving || undefined}>
      <AuthStage variant={variant} />
      <div className="auth__corner">
        <LocaleToggle />
        <ThemeToggle />
      </div>
      <main className="auth__panel">
        <div className="auth__card">
          <m.form animate={shake} onSubmit={onSubmit} noValidate className="auth__form">
            <div className="auth__head">
              <Logo size={40} className="auth__logo" />
              <h1 className="auth__title">{title}</h1>
              <p className="auth__subtitle">{subtitle}</p>
            </div>
            {children}
          </m.form>
          {footer}
        </div>
      </main>
    </div>
  )
}

export type SubmitPhase = 'idle' | 'busy' | 'done'

/** Full-width submit that shows a spinner while busy and a check once done. */
export function AuthSubmit({
  phase,
  label,
  busy,
  done,
}: {
  phase: SubmitPhase
  label: string
  busy: string
  done: string
}) {
  return (
    <Button
      type="submit"
      variant="primary"
      size="xlarge"
      fullWidth
      className="auth__submit"
      data-phase={phase}
      aria-busy={phase === 'busy' || undefined}
    >
      {phase === 'busy' ? (
        <>
          <Spinner size={14} color="currentColor" />
          {busy}
        </>
      ) : phase === 'done' ? (
        <>
          <Icon name="check" weight={2.4} />
          {done}
        </>
      ) : (
        label
      )}
    </Button>
  )
}
