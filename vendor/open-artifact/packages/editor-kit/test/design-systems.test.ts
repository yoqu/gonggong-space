/** Tests of the installed design systems loader. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArtifactCapability } from '@open-artifact/runtime';
import { DS_DIR, createSystemsLoader, type SystemsRead } from '../src/design-systems.ts';

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('createSystemsLoader', () => {
  it('reads each copy, reports unreadable ones, and reloads when the records or a tokens.json change', async () => {
    const files: Record<string, string> = {
      [`${DS_DIR}brand/tokens.json`]: JSON.stringify({ name: 'Brand', color: { tokens: [{ name: 'ink', value: '#111111' }] } }),
      [`${DS_DIR}broken/tokens.json`]: 'not json',
    };
    const changes = new Set<(event: { changes: Record<string, unknown> }) => void>();
    const artifact = {
      readText: async (path: string) => {
        if (!(path in files)) throw new Error('missing');
        return files[path]!;
      },
      onChange: (listener: (event: { changes: Record<string, unknown> }) => void) => {
        changes.add(listener);
        return () => changes.delete(listener);
      },
    } as unknown as ArtifactCapability;
    let records = [
      { namespace: 'brand', copiedAt: '1' },
      { namespace: 'broken', copiedAt: '1' },
      { namespace: 'gone', copiedAt: '1' },
    ];
    const listeners = new Set<() => void>();
    const reads: SystemsRead<string>[] = [];
    const loader = createSystemsLoader<{ namespace: string; copiedAt: string }, string>({
      artifact: () => artifact,
      records: () => records,
      subscribe: (listener) => listeners.add(listener),
      read: (record, tokens) => `${record.namespace}:${tokens.name}`,
      loaded: (result) => void reads.push(result),
    });
    loader.start();
    loader.start();
    await settle();
    assert.deepEqual(reads, [{ systems: ['brand:Brand'], missing: ['broken', 'gone'] }]);
    // The same records: nothing to do.
    for (const listener of listeners) listener();
    await settle();
    assert.equal(reads.length, 1);
    records = [{ namespace: 'brand', copiedAt: '2' }];
    for (const listener of listeners) listener();
    await settle();
    assert.deepEqual(reads.at(-1), { systems: ['brand:Brand'], missing: [] });
    for (const listener of changes) listener({ changes: { 'project/other.json': {} } });
    await settle();
    assert.equal(reads.length, 2);
    for (const listener of changes) listener({ changes: { [`${DS_DIR}brand/tokens.json`]: {} } });
    await settle();
    assert.equal(reads.length, 3);
  });
});
