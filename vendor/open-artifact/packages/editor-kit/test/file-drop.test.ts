import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guardFileDrops, type FileDragEvent, type FileDropTarget, type FileDropWindow } from '../src/file-drop.ts';

function fakeWindow() {
  const listeners = new Map<string, Set<(event: FileDragEvent) => void>>();
  const win: FileDropWindow = {
    addEventListener: (type, listener) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener),
    removeEventListener: (type, listener) => void listeners.get(type)?.delete(listener),
  };
  const fire = (type: string, types: string[], options: { defaultPrevented?: boolean; target?: FileDropTarget | null; path?: readonly unknown[] } = {}) => {
    const event = {
      type,
      defaultPrevented: options.defaultPrevented ?? false,
      target: options.target ?? null,
      composedPath: options.path ? () => options.path! : undefined,
      dataTransfer: { types, dropEffect: 'copy' },
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  return { win, fire, count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) };
}

describe('guardFileDrops', () => {
  it('keeps a file dropped where nothing takes it from opening in place of the editor', () => {
    const { win, fire, count } = fakeWindow();
    const stop = guardFileDrops(win);
    const over = fire('dragover', ['Files']);
    assert.equal(over.defaultPrevented, true);
    assert.equal(over.dataTransfer.dropEffect, 'none');
    assert.equal(fire('drop', ['Files']).defaultPrevented, true);
    stop();
    assert.equal(count(), 0);
  });

  it('leaves text drags and drops a handler already took alone', () => {
    const { win, fire } = fakeWindow();
    guardFileDrops(win);
    assert.equal(fire('drop', ['text/plain']).defaultPrevented, false);
    const taken = fire('dragover', ['Files'], { defaultPrevented: true });
    assert.equal(taken.dataTransfer.dropEffect, 'copy');
  });

  it('leaves enabled file inputs alone, but blocks drops on disabled ones', () => {
    const { win, fire } = fakeWindow();
    guardFileDrops(win);
    const enabled = fire('drop', ['Files'], { path: [{ tagName: 'INPUT', type: 'file', disabled: false }] });
    assert.equal(enabled.defaultPrevented, false);
    const disabled = fire('drop', ['Files'], { target: { tagName: 'INPUT', type: 'file', disabled: true } });
    assert.equal(disabled.defaultPrevented, true);
  });
});
