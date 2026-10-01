import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { locale } from './i18n'
import { ipc } from './ipc'
import { initTheme } from './theme'
import '@web/styles/index.css'
import './desktop.css'

initTheme()
void ipc.setLocale(locale).catch(() => {})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
