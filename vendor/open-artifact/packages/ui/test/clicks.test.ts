import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FOLLOW_UP_CLICK_MS,
  FOLLOW_UP_CLICK_SLOP_PX,
  guardFollowUpClicks,
  isFollowUpPress,
  swallowFollowUpClicks,
  type ClickGuardWindow,
  type FollowUpEvent,
  type FollowUpEventType,
} from '../src/clicks.ts';

/** A pointer event stand-in that records whether it was swallowed. */
function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = {
    type,
    clientX,
    clientY,
    swallowed: false,
    preventDefault() {},
    stopImmediatePropagation() {
      event.swallowed = true;
    },
  };
  return event;
}

/** A window stand-in with listeners and timers run by hand. */
function fakeWindow() {
  const listeners = new Set<{ type: FollowUpEventType; listener: (event: FollowUpEvent) => void }>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const win: ClickGuardWindow & { dispatch(event: FollowUpEvent & { type: FollowUpEventType }): void; count(): number; runTimers(): void } = {
    addEventListener(type, listener) {
      listeners.add({ type, listener });
    },
    removeEventListener(type, listener) {
      for (const entry of listeners) if (entry.type === type && entry.listener === listener) listeners.delete(entry);
    },
    setTimeout(callback) {
      timers.set(nextTimer, callback);
      return nextTimer++;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    dispatch(event) {
      for (const entry of [...listeners]) if (entry.type === event.type) entry.listener(event);
    },
    count: () => listeners.size,
    runTimers() {
      const due = [...timers.values()];
      timers.clear();
      for (const callback of due) callback();
    },
  };
  return win;
}

describe('follow-up clicks', () => {
  it('counts presses near the closing press and soon after it', () => {
    const origin = { x: 100, y: 100, at: 1000 };
    assert.equal(isFollowUpPress(origin, { clientX: 103, clientY: 98 }, 1200), true);
    assert.equal(isFollowUpPress(origin, { clientX: 100, clientY: 100 }, 1000 + FOLLOW_UP_CLICK_MS), true);
    assert.equal(isFollowUpPress(origin, { clientX: 100, clientY: 100 }, 1001 + FOLLOW_UP_CLICK_MS), false);
    assert.equal(isFollowUpPress(origin, { clientX: 100 + FOLLOW_UP_CLICK_SLOP_PX + 1, clientY: 100 }, 1100), false);
  });

  it('swallows the second click of a double click, and lets other presses through', () => {
    const win = fakeWindow();
    let now = 1000;
    guardFollowUpClicks(win, { x: 50, y: 50, at: 1000 }, () => now);
    now = 1150;
    const second = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'].map((type) => pointerEvent(type, 51, 50));
    for (const event of second) win.dispatch(event as FollowUpEvent & { type: FollowUpEventType });
    assert.deepEqual(second.map((event) => event.swallowed), [true, true, true, true, true, true]);
    const elsewhere = pointerEvent('pointerdown', 300, 300);
    win.dispatch(elsewhere as FollowUpEvent & { type: FollowUpEventType });
    assert.equal(elsewhere.swallowed, false);
  });

  it('keeps swallowing a press that began in time until its click', () => {
    const win = fakeWindow();
    let now = 1000;
    guardFollowUpClicks(win, { x: 0, y: 0, at: 1000 }, () => now);
    now = 1490;
    const down = pointerEvent('pointerdown', 0, 0);
    win.dispatch(down as FollowUpEvent & { type: FollowUpEventType });
    win.runTimers();
    now = 1600;
    const up = pointerEvent('pointerup', 0, 0);
    const click = pointerEvent('click', 0, 0);
    win.dispatch(up as FollowUpEvent & { type: FollowUpEventType });
    win.dispatch(click as FollowUpEvent & { type: FollowUpEventType });
    assert.deepEqual([down.swallowed, up.swallowed, click.swallowed], [true, true, true]);
    win.runTimers();
    assert.equal(win.count(), 0);
  });

  it('stops listening once the time is up', () => {
    const win = fakeWindow();
    guardFollowUpClicks(win, { x: 0, y: 0, at: 1000 }, () => 1000);
    assert.ok(win.count() > 0);
    win.runTimers();
    assert.equal(win.count(), 0);
  });

  it('starts nothing for a click made with the keyboard', () => {
    const win = fakeWindow();
    swallowFollowUpClicks({ detail: 0, clientX: 0, clientY: 0, view: win });
    assert.equal(win.count(), 0);
    swallowFollowUpClicks({ detail: 1, clientX: 0, clientY: 0, view: win });
    assert.ok(win.count() > 0);
  });
});
