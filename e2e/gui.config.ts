import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * Desktop previews on Linux (e2e/gui-preview.spec.ts), run by scripts/gui-e2e.sh: the shared server and web servers,
 * with Postgres already started by the script (as its own user; `pg.sh` would run initdb as root in the container).
 */
export default defineConfig({
  ...base,
  retries: 0,
  projects: [{ name: 'gui', testMatch: /gui-preview\.spec/ }],
  webServer: [
    { ...[base.webServer].flat()[0]!, command: 'pnpm --filter @gonggong/server start' },
    [base.webServer].flat()[1]!,
  ],
})
