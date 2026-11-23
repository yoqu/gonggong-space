/** Tests of the version-history wiring (Shell report and command, who may restore) and reading a version's files. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChromeCommand } from '@open-artifact/runtime';
import { readVersionFiles, wireVersionHistory } from '../src/collab/history-wiring.ts';

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('wireVersionHistory', () => {
  function fakeHistory(canRestore: boolean) {
    const listeners = new Set<(event: { n: number | null }) => void>();
    return {
      history: {
        list: async () => ({ versions: [], notices: [], canRestore }),
        onChange: (listener: (event: { n: number | null }) => void) => {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      },
      listeners,
    };
  }

  it('reports the history, answers the history command and stops cleanly', async () => {
    const { history, listeners } = fakeHistory(true);
    const reports: Array<{ history?: boolean }> = [];
    const handlers = new Set<(command: ChromeCommand) => void>();
    let toggles = 0;
    let canRestore: boolean | undefined;
    const stop = wireVersionHistory({
      history,
      roleMayRestore: true,
      report: (part) => reports.push(part),
      onCommand: (handler) => {
        handlers.add(handler);
        return () => void handlers.delete(handler);
      },
      toggle: () => toggles++,
      setCanRestore: (can) => (canRestore = can),
    });
    await settle();
    assert.deepEqual(reports, [{ history: true }]);
    assert.equal(canRestore, true);
    for (const handler of handlers) handler({ cmd: 'history' });
    for (const handler of handlers) handler({ cmd: 'comments_list' } as ChromeCommand);
    assert.equal(toggles, 1);
    stop();
    assert.deepEqual(reports.at(-1), { history: undefined });
    assert.equal(handlers.size, 0);
    assert.equal(listeners.size, 0);
  });

  it('never lets a role that may not restore restore, whatever the listing says', async () => {
    const { history } = fakeHistory(true);
    let canRestore: boolean | undefined;
    const stop = wireVersionHistory({ history, roleMayRestore: false, report: () => {}, onCommand: () => () => {}, toggle: () => {}, setCanRestore: (can) => (canRestore = can) });
    await settle();
    assert.equal(canRestore, false);
    stop();
  });
});

describe('readVersionFiles', () => {
  it('reads the wanted paths of a version and skips unreadable ones', async () => {
    const files: Record<string, string> = { 'db/elements/a': '{"type":"note"}', 'db/elements/b': '{}', 'project/x.md': '#' };
    const asked: string[] = [];
    const history = {
      files: async (n: number) => {
        assert.equal(n, 4);
        return Object.fromEntries(Object.keys(files).map((path) => [path, { sha256: '', size: 0 }])) as never;
      },
      read: async (_n: number, path: string) => {
        asked.push(path);
        if (path === 'db/elements/b') throw new Error('gone');
        return files[path]!;
      },
    };
    const read = await readVersionFiles(history, 4, (paths) => paths.filter((path) => path.startsWith('db/')), 2);
    assert.deepEqual(asked.sort(), ['db/elements/a', 'db/elements/b']);
    assert.deepEqual(read, [['db/elements/a', '{"type":"note"}']]);
  });
});
