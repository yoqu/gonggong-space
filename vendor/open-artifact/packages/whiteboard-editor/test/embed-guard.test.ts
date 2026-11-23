/**
 * Guarded embeds: the clip style and the bootstrap's private port, the
 * heartbeat, the keyboard guard, stop messages, and what Enter does to an
 * embed (use it, run it again).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { HtmlElement } from '@open-artifact/whiteboard-core';
import {
  EMBED_CLIP_STYLE,
  EMBED_EXCUSE_MS,
  EMBED_MISSES_TO_SILENCE,
  EMBED_MISSES_TO_STOP,
  EMBED_STOP_MESSAGES,
  EMBED_TAKE_BACKS_TO_STOP,
  buildEmbedSrcdoc,
  canRunEmbedAgain,
  createHeartbeat,
  createKeyboardGuard,
  embedBootstrap,
  embedKeyboardStopMessage,
  embedStopHint,
  isEmbedPortOffer,
  readEmbedPortMessage,
} from '../src/elements/embed.ts';
import { clearEmbedStop, embedEnterAction, embedKeyState, embedStopFor, stopEmbed, useEmbedStops } from '../src/elements/embed-control.ts';

/** An embed running `html`. */
function embed(id: string, html = '<p>Hi</p>'): HtmlElement {
  return { type: 'html', id, x: 0, y: 0, w: 320, h: 240, html };
}

/** A stand-in for a DOM event in the embed's page. */
interface FakeEvent {
  type: string;
  key: string;
  isTrusted: boolean;
  repeat: boolean;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  timeStamp: number;
  held: boolean;
  dataTransfer: { dropEffect: string };
}

/** The bootstrap run in a bare page: fire events at it, post board messages, and read what it told the board. */
function bootedEmbed(): { fire(type: string, init?: Partial<FakeEvent>): FakeEvent; board(message: object): void; told: unknown[] } {
  const listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  const told: unknown[] = [];
  const port1: { onmessage: ((event: { data: unknown }) => void) | null; postMessage(message: unknown): void } = {
    onmessage: null,
    postMessage(message) {
      // A copy made in this realm, as a real port would deliver it.
      told.push(structuredClone(message));
    },
  };
  class FakeEventBase {
    held = false;
    preventDefault(this: FakeEvent): void {
      this.held = true;
    }
    stopImmediatePropagation(): void {}
  }
  const context = {
    Reflect,
    JSON,
    Object,
    setTimeout,
    Event: FakeEventBase,
    MessagePort: { prototype: { postMessage: port1.postMessage } },
    MessageChannel: class {
      port1 = port1;
      port2 = {};
    },
    performance: { now: () => 0 },
    parent: { postMessage() {} },
    addEventListener(type: string, listener: (event: FakeEvent) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    window: {},
  };
  runInNewContext(embedBootstrap(undefined), context);
  return {
    told,
    fire(type, init = {}) {
      const event = Object.assign(new FakeEventBase(), {
        type,
        key: '',
        isTrusted: true,
        repeat: false,
        isComposing: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        timeStamp: 0,
        dataTransfer: { dropEffect: 'copy' },
        ...init,
      }) as FakeEvent;
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
    board(message) {
      port1.onmessage?.({ data: message });
    },
  };
}

describe('embed document', () => {
  it('clips the page: no margins, nothing scrolls past the card', () => {
    assert.equal(EMBED_CLIP_STYLE, 'html,body{margin:0;padding:0;overflow:hidden}');
    const doc = buildEmbedSrcdoc('<p>x</p>', undefined);
    assert.ok(doc.includes(`<style>${EMBED_CLIP_STYLE}</style>`));
    // The policy still comes first, and the bootstrap before the page.
    assert.ok(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
    assert.ok(doc.indexOf('<script>') < doc.indexOf('<p>x</p>'));
  });

  it('hands the board a private port before the page runs, and reports presses, Escape and echoes on it', () => {
    const boot = embedBootstrap(undefined);
    assert.ok(boot.includes('new MessageChannel()'));
    assert.ok(boot.includes("parent.postMessage({boardEmbed:'port'},'*',[channel.port2])"));
    assert.ok(boot.includes("tell({kind:'press'"));
    assert.ok(boot.includes("event.key==='Escape'"));
    assert.ok(boot.includes("tell({kind:'echo',n:data.ping})"));
    // Reports and holds back only trusted input.
    assert.equal(boot.match(/event\.isTrusted/g)?.length, 4);
  });

  it('keeps typing, Delete, paste and drops from the page until the embed is entered', () => {
    const page = bootedEmbed();
    const blocked = (type: string, init: Partial<FakeEvent> = {}): boolean => page.fire(type, init).held;
    for (const key of ['a', 'Delete', 'Backspace', 'Enter', 'F5', 'Tab']) assert.ok(blocked('keydown', { key }), key);
    assert.ok(blocked('keydown', { key: 'v', metaKey: true }));
    assert.ok(blocked('paste'));
    assert.ok(blocked('beforeinput'));
    assert.ok(blocked('drop'));
    const over = page.fire('dragover');
    assert.ok(over.held);
    assert.equal(over.dataTransfer.dropEffect, 'none');
    // Escape always goes through, and is reported.
    assert.ok(!blocked('keydown', { key: 'Escape' }));
    assert.deepEqual(page.told.at(-1), { kind: 'key', key: 'Escape' });
    // Scripted events are the page's own business.
    assert.ok(!blocked('keydown', { key: 'a', isTrusted: false }));
  });

  it('lets everything through once entered by a press or by the board, until Escape or the board ends it', () => {
    const page = bootedEmbed();
    page.fire('pointerdown');
    for (const key of ['a', 'Delete', 'F5', 'F24']) assert.ok(!page.fire('keydown', { key }).held, key);
    assert.ok(!page.fire('keydown', { key: 'z', ctrlKey: true }).held);
    assert.ok(!page.fire('paste').held);
    assert.ok(!page.fire('drop').held);
    page.fire('keydown', { key: 'Escape' });
    assert.ok(page.fire('keydown', { key: 'a' }).held);
    page.board({ enter: true });
    assert.ok(!page.fire('keydown', { key: 'a' }).held);
    page.board({ enter: false });
    assert.ok(page.fire('paste').held);
    // Pings are still echoed.
    page.board({ ping: 7 });
    assert.deepEqual(page.told.at(-1), { kind: 'echo', n: 7 });
  });

  it('reads port offers and port messages', () => {
    assert.ok(isEmbedPortOffer({ boardEmbed: 'port' }));
    assert.ok(!isEmbedPortOffer({ boardEmbed: 'save', state: '{}' }));
    assert.deepEqual(readEmbedPortMessage({ kind: 'press', age: 3 }), { kind: 'press', age: 3 });
    assert.deepEqual(readEmbedPortMessage({ kind: 'press' }), { kind: 'press', age: Infinity });
    assert.deepEqual(readEmbedPortMessage({ kind: 'key', key: 'Escape' }), { kind: 'key', key: 'Escape' });
    assert.equal(readEmbedPortMessage({ kind: 'key', key: 'Enter' }), undefined);
    assert.deepEqual(readEmbedPortMessage({ kind: 'echo', n: 4 }), { kind: 'echo', n: 4 });
    assert.equal(readEmbedPortMessage('echo'), undefined);
  });
});

describe('createHeartbeat', () => {
  it('stays well while every ping is answered', () => {
    const heart = createHeartbeat();
    for (let i = 0; i < 10; i += 1) {
      const { verdict, ping } = heart.beat();
      assert.equal(verdict, 'ok');
      assert.equal(heart.echo(ping), false);
    }
  });

  it('goes silent after five misses, comes back on an echo, and stops after sixty', () => {
    const heart = createHeartbeat();
    let last = heart.beat();
    const verdicts: string[] = [];
    for (let i = 0; i < EMBED_MISSES_TO_SILENCE; i += 1) {
      last = heart.beat();
      verdicts.push(last.verdict);
    }
    assert.deepEqual(verdicts, ['ok', 'ok', 'ok', 'ok', 'silent']);
    assert.ok(heart.silent);
    // A late echo of an old ping does not count; the current one does.
    assert.equal(heart.echo(last.ping - 1), false);
    assert.equal(heart.echo(last.ping), true);
    assert.ok(!heart.silent);

    const quiet = createHeartbeat();
    quiet.beat();
    let verdict = 'ok';
    let beats = 0;
    while (verdict !== 'stop') {
      verdict = quiet.beat().verdict;
      beats += 1;
    }
    assert.equal(beats, EMBED_MISSES_TO_STOP);
  });

  it('does not count beats skipped while the page is hidden', () => {
    const heart = createHeartbeat(2, 3);
    heart.beat();
    for (let i = 0; i < 10; i += 1) heart.rest();
    assert.equal(heart.beat().verdict, 'ok');
  });
});

describe('createKeyboardGuard', () => {
  it('lets an embed hold the keyboard after a fresh press it was let have, or after Enter', () => {
    const guard = createKeyboardGuard();
    assert.equal(guard.pressed(10, true, 1000), true);
    assert.equal(guard.settle(1050), 'keep');
    guard.release();
    guard.allow(2000);
    assert.equal(guard.settle(2050), 'keep');
  });

  it('takes the keyboard back twice and stops the embed the third time', () => {
    const guard = createKeyboardGuard();
    const verdicts = Array.from({ length: EMBED_TAKE_BACKS_TO_STOP }, (_, i) => guard.settle(1000 * i));
    assert.deepEqual(verdicts, ['take-back', 'take-back', 'stop']);
  });

  it('forgives take-backs after a press, and excuses focus right after a press it was not let have', () => {
    const guard = createKeyboardGuard();
    guard.settle(0);
    guard.settle(10);
    guard.pressed(5, true, 20);
    guard.release();
    assert.equal(guard.settle(30), 'take-back');
    // A stale press, or one the board did not let through, excuses once.
    assert.equal(guard.pressed(5000, true, 100), false);
    assert.equal(guard.settle(100 + EMBED_EXCUSE_MS), 'excused');
    assert.equal(guard.pressed(5, false, 1000), false);
    assert.equal(guard.settle(1000 + EMBED_EXCUSE_MS + 1), 'take-back');
  });

  it('ends a hold when focus goes elsewhere, unless the embed was just handed the keyboard', () => {
    const guard = createKeyboardGuard();
    guard.allow(1000);
    guard.left(1100);
    assert.ok(guard.owner);
    guard.left(1400);
    assert.ok(!guard.owner);
  });
});

describe('stopped embeds', () => {
  it('says why, and only an embed stopped for the keyboard runs again in place', () => {
    assert.equal(EMBED_STOP_MESSAGES.silent, 'It stopped responding.');
    assert.equal(EMBED_STOP_MESSAGES.keyboard, 'It kept taking over the keyboard.');
    assert.ok(canRunEmbedAgain('keyboard'));
    assert.equal(embedStopHint('keyboard'), undefined);
    for (const reason of ['navigated', 'flooded', 'silent'] as const) {
      assert.ok(!canRunEmbedAgain(reason));
      assert.equal(embedStopHint(reason), 'Reopen the board to run it again.');
    }
  });

  it('names the embed when announcing a keyboard stop, cutting long titles', () => {
    assert.equal(embedKeyboardStopMessage(undefined), 'An embed was stopped: it kept taking over the keyboard. Press Return on it to run it again.');
    assert.ok(embedKeyboardStopMessage('Clock').startsWith('Clock was stopped'));
    assert.ok(embedKeyboardStopMessage('x'.repeat(40)).startsWith('x'.repeat(30) + '… was stopped'));
  });

  it('keeps a stop for the HTML it stopped; Enter uses a running embed and runs a keyboard-stopped one again', () => {
    const element = embed('e1');
    assert.equal(embedKeyState(element), 'runs');
    assert.equal(embedEnterAction(element), 'use');

    stopEmbed('e1', element.html, 'keyboard');
    assert.equal(embedStopFor(useEmbedStops.getState().stops, 'e1', element.html), 'keyboard');
    assert.equal(embedKeyState(element), 'off');
    assert.equal(embedEnterAction(element), 'run-again');
    // Editing the HTML ends the stop.
    assert.equal(embedKeyState({ ...element, html: '<p>New</p>' }), 'runs');

    stopEmbed('e1', element.html, 'navigated');
    assert.equal(embedKeyState(element), undefined);
    assert.equal(embedEnterAction(element), undefined);
    clearEmbedStop('e1');
    assert.equal(embedKeyState(element), 'runs');
  });

  it('has nothing for Enter to do to an empty or refused embed', () => {
    assert.equal(embedKeyState(embed('e2', '  ')), undefined);
    assert.equal(embedKeyState(embed('e3', '<iframe src=x>')), undefined);
  });
});
