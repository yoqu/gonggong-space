import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { scrollsOverflow } from '../src/focusables.ts';
import {
  guardHeldActivation,
  HELD_KEY_GUARD_MAX_MS,
  HELD_KEY_SETTLE_MS,
  isComposingKey,
  isRepeatedActivation,
  preventRepeatedActivation,
  withRepeatGuard,
  type KeyGuardEvent,
  type KeyGuardWindow,
} from '../src/keys.ts';

/** A keydown-like event that records what was prevented. */
function keyEvent(key: string, init: { repeat?: boolean; type?: string; target?: unknown; currentTarget?: unknown } = {}) {
  const event = {
    key,
    repeat: init.repeat ?? false,
    type: init.type ?? 'keydown',
    target: init.target ?? 'row',
    currentTarget: init.currentTarget ?? init.target ?? 'row',
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      event.stopped = true;
    },
  };
  return event;
}

/** A window stand-in with real listeners and Node's (mocked) timers. */
function fakeWindow() {
  const listeners = new Set<{ type: string; listener: (event: KeyGuardEvent) => void }>();
  const win: KeyGuardWindow & { dispatch(event: KeyGuardEvent): void; count(): number } = {
    addEventListener(type, listener) {
      listeners.add({ type, listener });
    },
    removeEventListener(type, listener) {
      for (const entry of listeners) if (entry.type === type && entry.listener === listener) listeners.delete(entry);
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    dispatch(event) {
      for (const entry of [...listeners]) if (entry.type === event.type) entry.listener(event);
    },
    count: () => listeners.size,
  };
  return win;
}

describe('repeat guard', () => {
  it('knows a held Enter or Space', () => {
    assert.equal(isRepeatedActivation({ key: 'Enter', repeat: true }), true);
    assert.equal(isRepeatedActivation({ key: ' ', repeat: true }), true);
    assert.equal(isRepeatedActivation({ key: 'Enter', repeat: false }), false);
    assert.equal(isRepeatedActivation({ key: 'ArrowDown', repeat: true }), false);
  });

  it('prevents only repeats on the control itself', () => {
    const first = keyEvent('Enter');
    preventRepeatedActivation(first);
    assert.equal(first.defaultPrevented, false);
    const repeat = keyEvent('Enter', { repeat: true });
    preventRepeatedActivation(repeat);
    assert.equal(repeat.defaultPrevented, true);
    const fromChild = keyEvent('Enter', { repeat: true, target: 'field', currentTarget: 'row' });
    preventRepeatedActivation(fromChild);
    assert.equal(fromChild.defaultPrevented, false);
  });

  it('still runs the wrapped handler', () => {
    const seen: boolean[] = [];
    const handler = withRepeatGuard((event: ReturnType<typeof keyEvent>) => seen.push(event.defaultPrevented));
    handler(keyEvent('Enter'));
    handler(keyEvent('Enter', { repeat: true }));
    assert.deepEqual(seen, [false, true]);
  });
});

describe('guardHeldActivation', () => {
  const inside = (target: unknown) => target === 'toast';

  it('swallows Enter outside until the key is released and settles', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const win = fakeWindow();
      guardHeldActivation(win, 'Enter', inside);
      const repeat = keyEvent('Enter', { repeat: true, target: 'delete-button' });
      win.dispatch(repeat);
      assert.equal(repeat.defaultPrevented, true);
      assert.equal(repeat.stopped, true);
      const letter = keyEvent('a', { target: 'delete-button' });
      win.dispatch(letter);
      assert.equal(letter.defaultPrevented, false);
      const inToast = keyEvent('Enter', { repeat: true, target: 'toast' });
      win.dispatch(inToast);
      assert.equal(inToast.defaultPrevented, false);
      win.dispatch(keyEvent('Enter', { type: 'keyup', target: 'delete-button' }));
      assert.equal(win.count(), 2);
      mock.timers.tick(HELD_KEY_SETTLE_MS);
      assert.equal(win.count(), 0);
      const later = keyEvent('Enter', { target: 'delete-button' });
      win.dispatch(later);
      assert.equal(later.defaultPrevented, false);
    } finally {
      mock.timers.reset();
    }
  });

  it('cancels a Space keyup outside, which would press a native button', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const win = fakeWindow();
      guardHeldActivation(win, ' ', inside);
      const up = keyEvent(' ', { type: 'keyup', target: 'delete-button' });
      win.dispatch(up);
      assert.equal(up.defaultPrevented, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('ends on its own after the limit, or when asked', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const win = fakeWindow();
      guardHeldActivation(win, 'Enter', inside);
      mock.timers.tick(HELD_KEY_GUARD_MAX_MS);
      assert.equal(win.count(), 0);
      const end = guardHeldActivation(win, 'Enter', inside);
      assert.equal(win.count(), 2);
      end();
      assert.equal(win.count(), 0);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('scrollsOverflow', () => {
  const box = { scrollWidth: 100, clientWidth: 100, scrollHeight: 400, clientHeight: 200, overflowX: 'auto', overflowY: 'auto' };

  it('is true when content overflows a scrolling axis', () => {
    assert.equal(scrollsOverflow(box), true);
    assert.equal(scrollsOverflow({ ...box, overflowY: 'scroll' }), true);
  });

  it('is false for hidden, clipped or visible overflow, and for a pixel of rounding', () => {
    assert.equal(scrollsOverflow({ ...box, overflowY: 'hidden' }), false);
    assert.equal(scrollsOverflow({ ...box, overflowY: 'clip' }), false);
    assert.equal(scrollsOverflow({ ...box, overflowY: 'visible' }), false);
    assert.equal(scrollsOverflow({ ...box, scrollHeight: 201 }), false);
  });
});

describe('isComposingKey', () => {
  it('is true while an input method composes, including the 229 key code Safari sends at its end', () => {
    assert.equal(isComposingKey({ isComposing: true, keyCode: 13 }), true);
    assert.equal(isComposingKey({ isComposing: false, keyCode: 229 }), true);
    assert.equal(isComposingKey({ isComposing: false, keyCode: 13 }), false);
    assert.equal(isComposingKey({}), false);
  });
});
