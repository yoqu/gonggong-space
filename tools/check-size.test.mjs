import assert from 'node:assert/strict'
import test from 'node:test'
import { checkSizes, inScope, LIMIT, updatedBaseline } from '../scripts/check-size.mjs'

const big = LIMIT + 200

test('a new file over the limit fails, one at the limit passes', () => {
  assert.deepEqual(checkSizes({ 'a.ts': LIMIT }, {}), [])
  assert.equal(checkSizes({ 'a.ts': LIMIT + 1 }, {}).length, 1)
})

test('a baselined file may stay or shrink, not grow', () => {
  assert.deepEqual(checkSizes({ 'a.ts': big }, { 'a.ts': big }), [])
  assert.deepEqual(checkSizes({ 'a.ts': big - 50 }, { 'a.ts': big }), [])
  assert.equal(checkSizes({ 'a.ts': big + 1 }, { 'a.ts': big }).length, 1)
})

test('update only shrinks the baseline: smaller counts, files back under the limit or gone dropped', () => {
  const baseline = { 'a.ts': big, 'b.ts': big, 'c.ts': big, 'd.ts': big }
  const sizes = { 'a.ts': big - 10, 'b.ts': LIMIT - 1, 'd.ts': big + 5, 'e.ts': big }
  assert.deepEqual(updatedBaseline(sizes, baseline), { 'a.ts': big - 10, 'd.ts': big })
})

test('scope: source ts/tsx/rs/css, not tests, migrations or English dictionaries', () => {
  for (const f of [
    'apps/web/src/features/chat/Canvas.tsx',
    'apps/web/src/styles/app.css',
    'packages/protocol/src/web/git.ts',
    'crates/gonggong/src/run.rs',
    'apps/desktop/src-tauri/src/lib.rs',
  ])
    assert.ok(inScope(f), f)
  for (const f of [
    'apps/web/src/features/chat/Canvas.test.tsx',
    'apps/server/test/support/app.ts',
    'apps/server/src/db/drizzle/0001.ts',
    'apps/server/src/db/schema.ts',
    'crates/gonggong/tests/it/run.rs',
    'crates/gonggong/src/protocol/tests.rs',
    'apps/web/src/features/chat/en.ts',
    'packages/protocol/src/i18n-en.ts',
    'crates/gonggong/src/i18n/en.rs',
    'e2e/chat.spec.ts',
    'tools/mock-agent/src/main.ts',
    'apps/web/src/features/chat/notes.md',
  ])
    assert.ok(!inScope(f), f)
})
