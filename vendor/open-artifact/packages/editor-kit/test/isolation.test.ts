/**
 * The kit stays shared: it imports nothing of any editor, and its pure
 * entry (`@open-artifact/editor-kit`) stays free of UI so node's test
 * runner (no JSX, no DOM) loads it.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const SRC = new URL('../src/', import.meta.url);

/** Every source file, relative to src/. */
const sources = (): string[] =>
  (readdirSync(SRC, { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file)).map((file) => file.split('\\').join('/'));

describe('editor kit isolation', () => {
  it('imports nothing of an editor', () => {
    const allowed = /^(\.\.?\/[\w/-]+\.tsx?|@open-artifact\/(runtime|ui|design-system-core)|react|react-dom|zustand|lucide-react|clsx|@base-ui\/react\/[\w-]+)$/;
    for (const file of sources()) {
      const text = readFileSync(new URL(file, SRC), 'utf8');
      for (const [, from] of text.matchAll(/from '([^']+)'/g)) assert.match(from!, allowed, `${file} imports ${from}`);
    }
  });

  it('keeps the pure entry free of UI', () => {
    for (const file of sources()) {
      // react.ts is the views' entry: it re-exports the .tsx files.
      if (!file.endsWith('.ts') || file === 'react.ts') continue;
      const text = readFileSync(new URL(file, SRC), 'utf8');
      assert.doesNotMatch(text, /from '(@open-artifact\/ui|react|lucide-react|@base-ui\/[^']+|[^']+\.tsx)'/, `${file} imports UI`);
    }
  });

  it('loads the pure entry without a DOM', async () => {
    const kit = await import('../src/index.ts');
    assert.equal(typeof kit.createCollab, 'function');
    assert.equal(typeof kit.mergeLines, 'function');
  });
});
