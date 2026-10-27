import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** Real terminal only: unlike the main config, no first-run test invokes an external model. */
export default defineConfig({
  ...base,
  retries: 0,
  projects: [{ name: 'terminal', testMatch: /terminal\.spec/ }],
})
