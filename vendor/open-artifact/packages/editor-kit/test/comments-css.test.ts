import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
// @ts-expect-error: a plain .mjs build script, without type declarations.
import { buildCommentsCss, commentsCssModule } from '../scripts/build-comments-css.mjs';

const generated = readFileSync(new URL('../src/collab/cds/comments-css.ts', import.meta.url), 'utf8');

describe('comments stylesheet', () => {
  it('comments-css.ts is current with comments.css and the views’ classes', async () => {
    const expected = commentsCssModule(await buildCommentsCss());
    assert.ok(generated === expected, 'run node packages/editor-kit/scripts/build-comments-css.mjs');
  });

  it('defines the tokens and utilities the views use', () => {
    for (const rule of ['.bg-surface-2{', '.text-body{', '.h-control{', '.gap-xs{gap:var(--cds-gap-xs)}', '[data-mode=dark]']) {
      assert.ok(generated.includes(rule), rule);
    }
  });
});
