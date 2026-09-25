import { type ReactNode, useState } from 'react'
import { resolveTheme, setTheme } from '../../app/theme'
import { IconButton } from '../../ui'

function ThemeToggle() {
  const [dark, setDark] = useState(() => resolveTheme() === 'dark')
  return (
    <IconButton
      title={dark ? '切换到浅色' : '切换到深色'}
      className="auth__theme"
      onClick={() => {
        setTheme(dark ? 'light' : 'dark')
        setDark(!dark)
      }}
    >
      {dark ? ('sun' as const) : ('moon' as const)}
    </IconButton>
  )
}

/** Calm window backdrop shared by the auth screens: theme switch in the corner, the card centered. */
export function AuthStage({
  testId,
  leaving,
  children,
}: {
  testId?: string
  leaving?: boolean
  children: ReactNode
}) {
  return (
    <div className="auth" data-testid={testId} data-leaving={leaving || undefined}>
      <ThemeToggle />
      <main className="auth__stage">{children}</main>
    </div>
  )
}
