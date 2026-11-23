/** `assertMayExport`: a print asks the host's `downloads.check` first where the browser saves files; elsewhere it passes. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DownloadsCapability } from '@open-artifact/runtime';
import { assertMayExport } from '../src/downloads.ts';

describe('assertMayExport', () => {
  const save: DownloadsCapability['save'] = async () => ({});

  it('passes with no downloads, with a host that saves itself, and with no check', async () => {
    await assertMayExport(null);
    await assertMayExport(undefined);
    let asked = 0;
    await assertMayExport({ save, check: async () => void asked++ });
    await assertMayExport({ save, browser: true });
    assert.equal(asked, 0);
  });

  it("throws the host's refusal where the browser saves", async () => {
    const refusal = new Error('The owner has not let viewers download or export this artifact.');
    await assert.rejects(assertMayExport({ save, browser: true, check: async () => Promise.reject(refusal) }), (error) => error === refusal);
    let asked = 0;
    await assertMayExport({ save, browser: true, check: async () => void asked++ });
    assert.equal(asked, 1);
  });
});
