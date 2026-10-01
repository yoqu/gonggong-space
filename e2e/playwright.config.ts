import { defineConfig } from '@playwright/test'
import { SERVER_LOG } from './helpers'

const SERVER_PORT = 8790
const WEB_PORT = 5190

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  // Real agents depend on external model services; a retry absorbs their transient errors and is reported as flaky.
  retries: 1,
  // The first-run scenario needs the pristine bootstrap admin; everything else runs after it.
  projects: [
    { name: 'first-run', testMatch: /m1-walking-skeleton/ },
    { name: 'rest', testIgnore: /m1-walking-skeleton/, dependencies: ['first-run'] },
  ],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: 'retain-on-failure', locale: 'zh-CN' },
  webServer: [
    {
      command: `bash ../scripts/pg.sh reset gonggong_e2e && pnpm --filter @gonggong/server start 2>&1 | tee ${SERVER_LOG}`,
      env: {
        PORT: String(SERVER_PORT),
        GONGGONG_LOG: '1',
        GONGGONG_DB: 'gonggong_e2e',
        GONGGONG_ADMIN_PASSWORD: 'admin-init-pass',
      },
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @gonggong/web dev --strictPort',
      env: { WEB_PORT: String(WEB_PORT), GONGGONG_SERVER: `http://127.0.0.1:${SERVER_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
})
