import { Radar } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { ApiError } from '../../lib/api'
import './auth.css'

export const errorText = (err: unknown) =>
  err instanceof ApiError && err.code !== 'http_error' ? err.message : '无法连接服务器，请稍后重试'

/** Centered 360px card shared by the login and forced password-change screens (Web 对话.dc.html login). */
export function AuthCard({
  title,
  subtitle,
  testId,
  onSubmit,
  children,
}: {
  title: string
  subtitle: string
  testId?: string
  onSubmit: (e: FormEvent) => void
  children: ReactNode
}) {
  return (
    <div className="auth" data-testid={testId}>
      <form className="auth__card" onSubmit={onSubmit} noValidate>
        <div className="auth__brand">
          <span className="brand-mark brand-mark--lg">
            <Radar size={18} />
          </span>
          <span className="auth__product">AI 团队工作区</span>
        </div>
        <div className="auth__head">
          <h1 className="auth__title">{title}</h1>
          <p className="auth__subtitle">{subtitle}</p>
        </div>
        {children}
      </form>
    </div>
  )
}
