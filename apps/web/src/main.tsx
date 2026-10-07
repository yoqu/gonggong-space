import { LazyMotion, MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { initTheme } from './app/theme'
import { trackWindowFocus } from './app/windowFocus'
import './styles/index.css'

initTheme()
trackWindowFocus()

// Animation features load after first paint; `m` elements render their initial state until then.
const motionFeatures = () => import('./lib/motionFeatures').then((m) => m.default)

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <LazyMotion features={motionFeatures} strict>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LazyMotion>
    </MotionConfig>
  </StrictMode>,
)
