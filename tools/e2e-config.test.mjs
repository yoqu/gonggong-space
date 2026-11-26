import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const E2E_DIR = join(ROOT, 'e2e')

const REAL_LLM_SPECS = [
  'antigravity-delegation.spec.ts',
  'approval-reduction.spec.ts',
  'bind-link.spec.ts',
  'bot-sharing.spec.ts',
  'm1-edges.spec.ts',
  'm1-walking-skeleton.spec.ts',
  'm2-partition.spec.ts',
  'm3-governance.spec.ts',
  'm4-interaction.spec.ts',
  'm5-admin-ops.spec.ts',
  'mention-card.spec.ts',
  'model-config.spec.ts',
  'repo-access.spec.ts',
  'teams.spec.ts',
  'tls.spec.ts',
]

function listProjectFiles(args) {
  const out = execFileSync('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e', ...args, '--list'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const files = new Set()
  for (const line of out.split('\n')) {
    const m = line.match(/›\s+([^\s:]+\.spec\.ts):\d+:\d+/)
    if (m) files.add(m[1])
  }
  return files
}

test('e2e specs avoid hardcoded web port 5190, default DB name, and direct admin-pass-2 logins', () => {
  const specs = readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
  const hardcodedPort = []
  const hardcodedDb = []
  const directAdminLogin = []

  for (const file of specs) {
    const content = readFileSync(join(E2E_DIR, file), 'utf8')
    if (content.includes('127.0.0.1:5190')) hardcodedPort.push(file)
    if (/'gonggong_e2e'/.test(content) && !content.includes('GONGGONG_E2E_DB')) hardcodedDb.push(file)
    if (file !== 'm1-walking-skeleton.spec.ts' && /\/api\/auth\/login[^\n]*admin-pass-2/.test(content)) {
      directAdminLogin.push(file)
    }
  }

  assert.deepEqual(hardcodedPort, [], `specs still hardcode 127.0.0.1:5190: ${hardcodedPort.join(', ')}`)
  assert.deepEqual(hardcodedDb, [], `specs still hardcode gonggong_e2e DB: ${hardcodedDb.join(', ')}`)
  assert.deepEqual(
    directAdminLogin,
    [],
    `specs still bypass adminSession with admin-pass-2: ${directAdminLogin.join(', ')}`,
  )
})

test('package.json and playwright projects partition all e2e specs cleanly into fast and live', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['e2e:fast'], 'playwright test -c e2e --project=fast --no-deps')
  assert.equal(pkg.scripts['e2e:live'], 'playwright test -c e2e --project=live')

  const allSpecs = readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
  const fastFiles = listProjectFiles(['--project=fast', '--no-deps'])
  const liveFiles = listProjectFiles(['--project=live'])

  assert.ok(fastFiles.size > 0, 'fast project must select non-LLM specs')
  for (const llmSpec of REAL_LLM_SPECS) {
    assert.ok(!fastFiles.has(llmSpec), `fast project must not include LLM/first-run spec ${llmSpec}`)
    assert.ok(liveFiles.has(llmSpec), `live project must include LLM/first-run spec ${llmSpec}`)
  }
  const overlap = [...fastFiles].filter((f) => liveFiles.has(f))
  assert.deepEqual(overlap, [], `fast and live overlap: ${overlap.join(', ')}`)
  const union = [...new Set([...fastFiles, ...liveFiles])].sort()
  assert.deepEqual(union, allSpecs, 'fast + live must cover every e2e/*.spec.ts file')
})
