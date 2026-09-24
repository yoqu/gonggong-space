import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { initTheme } from './app/theme'
import { trackWindowFocus } from './app/windowFocus'
import './styles/index.css'

initTheme()
trackWindowFocus()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
)
