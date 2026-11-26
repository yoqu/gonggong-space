import { defineConfig } from '@playwright/test'
import { SERVER_LOG } from './helpers'

const SERVER_PORT = Number(process.env.GONGGONG_E2E_PORT ?? 8790)
const WEB_PORT = Number(process.env.GONGGONG_E2E_WEB_PORT ?? 5190)
const DB = process.env.GONGGONG_E2E_DB ?? 'gonggong_e2e'

// Specs that run without external LLM credentials (mock-agent, pure UI/API, local daemon flows).
const FAST_SPECS = [
  'agent-plan',
  'artifact-shell-s0',
  'artifacts',
  'connectors',
  'context-live',
  'feishu-admin',
  'force-sync',
  'git-idea',
  'git-local-workspace',
  'git-ops',
  'git-r4',
  'git-r5',
  'group-tabs',
  'm0-skeleton',
  'machine-admin',
  'market',
  'mcp-tools',
  'mobile-composer',
  'multi-repo-diff',
  'native-agents',
  'plugins',
  'previews',
  'providers',
  'repo-workspace',
  'rich-ui',
  'schedules',
  'send-attachments',
  'team-sections',
  'team-skills',
  'terminal',
  'threads',
  'two-machines',
  'unread-notify',
].map((name) => new RegExp(`(^|[\\\\/])${name}\\.spec\\.ts$`))

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  // Real agents depend on external model services; a retry absorbs their transient errors and is reported as flaky.
  retries: 1,
  // The first-run scenario needs the pristine bootstrap admin; in a full `pnpm e2e` run both fast and live wait
  // on it. `pnpm e2e:fast` passes `--project=fast --no-deps` to skip first-run and external LLM specs.
  projects: [
    { name: 'first-run', testMatch: /m1-walking-skeleton/ },
    { name: 'fast', testMatch: FAST_SPECS, dependencies: ['first-run'] },
    { name: 'live', testIgnore: [/m1-walking-skeleton/, ...FAST_SPECS], dependencies: ['first-run'] },
  ],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: 'retain-on-failure', locale: 'zh-CN' },
  webServer: [
    {
      command: `bash ../scripts/pg.sh reset ${DB} && pnpm --filter @gonggong/server start 2>&1 | tee ${SERVER_LOG}`,
      env: {
        PORT: String(SERVER_PORT),
        GONGGONG_LOG: '1',
        GONGGONG_DB: DB,
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
