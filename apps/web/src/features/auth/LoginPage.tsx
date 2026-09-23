import { Radar } from 'lucide-react'

/** Placeholder: the auth slice (S1) implements the form. */
export function LoginPage() {
  return (
    <div className="app-center" data-testid="login-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="brand-mark brand-mark--lg">
          <Radar size={18} />
        </span>
        <span style={{ fontSize: 17, fontWeight: 600 }}>AI 团队工作区</span>
      </div>
    </div>
  )
}
