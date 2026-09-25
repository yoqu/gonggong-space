import { motion, useAnimationControls } from 'motion/react'
import { type FormEvent, type ReactNode, useEffect } from 'react'
import { ApiError } from '../../lib/api'
import { Logo } from '../../ui'
import { AuthStage } from './AuthStage'
import './auth.css'

export const errorText = (err: unknown) =>
  err instanceof ApiError && err.code !== 'http_error' ? err.message : '无法连接服务器，请稍后重试'

/**
 * Centered auth card shared by login, sign-up and the forced password change.
 * `errorKey` changes on every failed submit so the form shakes once per failure.
 */
export function AuthCard({
  title,
  subtitle,
  testId,
  errorKey,
  leaving,
  onSubmit,
  children,
  footer,
}: {
  title: string
  subtitle: string
  testId?: string
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
    <AuthStage testId={testId} leaving={leaving}>
      <div className="auth__card">
        <motion.form animate={shake} onSubmit={onSubmit} noValidate className="auth__form">
          <div className="auth__head">
            <Logo size={56} motion="enter" className="auth__logo" />
            <h1 className="auth__title">{title}</h1>
            <p className="auth__subtitle">{subtitle}</p>
          </div>
          {children}
        </motion.form>
        {footer}
      </div>
    </AuthStage>
  )
}
