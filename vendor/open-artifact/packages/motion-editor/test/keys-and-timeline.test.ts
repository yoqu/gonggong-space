import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTextEntryTarget, TEXT_ENTRY_SELECTOR } from '../src/keyboard/install.ts';
import { comboMatches, createKeyRegistry, normalizeKey, type KeyPress } from '../src/keyboard/registry.ts';
import { formatSceneSeconds, partSpans, scrubTime, spanAt, thumbnailTimes, timeToX, xToTime } from '../src/timeline/timeline-math.ts';
import { videoViewContext, viewMode } from '../src/app/view-shape.ts';

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...more });

test('keys match in either case, with modifiers told apart', () => {
  assert.equal(normalizeKey('K'), 'k');
  assert.equal(normalizeKey('Spacebar'), ' ');
  assert.equal(comboMatches({ key: 'k' }, press('K')), true);
  assert.equal(comboMatches({ key: 'ArrowLeft', shift: true }, press('ArrowLeft')), false);
  assert.equal(comboMatches({ key: '\\', mod: true }, press('\\', { ctrlKey: true })), true);
});

test('the registry: the latest match wins, `when` gates, fields and repeats are respected', () => {
  const registry = createKeyRegistry();
  const ran: string[] = [];
  let mode = false;
  registry.register({ id: 'play', keys: [{ key: 'Enter' }], label: 'Play', run: () => ran.push('play') });
  const stop = registry.register({ id: 'comment', keys: [{ key: 'Enter' }], label: 'Comment', when: () => mode, run: () => ran.push('comment') });
  registry.register({ id: 'seek', keys: [{ key: 'ArrowRight' }], label: 'Seek', repeats: true, run: () => ran.push('seek') });
  registry.register({ id: 'panel', keys: [{ key: '\\', mod: true }], label: 'Panel', everywhere: true, run: () => ran.push('panel') });
  assert.equal(registry.match(press('Enter'), false)?.id, 'play');
  mode = true;
  assert.equal(registry.match(press('Enter'), false)?.id, 'comment');
  assert.equal(registry.match(press('Enter', { repeat: true }), false), null);
  assert.equal(registry.match(press('ArrowRight', { repeat: true }), false)?.id, 'seek');
  assert.equal(registry.match(press('ArrowRight'), true), null);
  assert.equal(registry.match(press('\\', { metaKey: true }), true)?.id, 'panel');
  stop();
  assert.equal(registry.match(press('Enter'), false)?.id, 'play');
  assert.equal(registry.list().length, 3);
});

test('timeline geometry maps seconds and pixels both ways, clamped', () => {
  assert.equal(timeToX(5, 10, 200), 100);
  assert.equal(timeToX(20, 10, 200), 200);
  assert.equal(xToTime(50, 10, 200), 2.5);
  assert.equal(xToTime(-5, 10, 200), 0);
  assert.equal(timeToX(1, 0, 200), 0);
  assert.equal(scrubTime(200, 10, 200, 30), 10 - 1 / 30);
  assert.equal(scrubTime(51, 10, 200, 10), 2.6);
});

test('scene cards come from the clock parts; one part draws none', () => {
  const parts = [
    { key: 'intro', label: 'Intro', playStart: 0, playDur: 4 },
    { key: 'end', label: 'End', playStart: 4, playDur: 6 },
  ];
  const spans = partSpans(parts, 10, 100);
  assert.deepEqual(
    spans.map((span) => [span.left, span.width, span.index]),
    [
      [0, 40, 0],
      [40, 60, 1],
    ],
  );
  assert.deepEqual(partSpans(parts.slice(0, 1), 10, 100), []);
  assert.equal(spanAt(spans, 4)?.key, 'end');
  assert.equal(spanAt(spans, 3.99)?.key, 'intro');
  assert.equal(spanAt(spans, 10)?.key, 'end');
});

test('thumbnails fill a card, each showing the middle of its stretch', () => {
  assert.deepEqual(thumbnailTimes({ start: 2, dur: 4, width: 130 }, 64), [3, 5]);
  assert.deepEqual(thumbnailTimes({ start: 0, dur: 4, width: 10 }, 64), [2]);
  assert.deepEqual(thumbnailTimes({ start: 0, dur: 0, width: 100 }, 64), []);
  assert.equal(formatSceneSeconds(4), '4 s');
  assert.equal(formatSceneSeconds(2.46), '2.5 s');
});

test('the view context names the mode, and the playhead only while paused', () => {
  assert.equal(viewMode(null), 'player');
  assert.equal(viewMode('export'), 'export');
  assert.equal(viewMode('layers'), 'tweaks');
  const paused = videoViewContext({ panel: null, time: 3.456, playing: false, sceneKey: 'intro', dirty: false, handEditRecords: ['modules/recut.json'] });
  assert.deepEqual(paused, { mode: 'player', dirty: false, selected: [], handEditRecords: ['modules/recut.json'], at: 3.46, scene: 'intro' });
  const playing = videoViewContext({ panel: null, time: 3, playing: true, sceneKey: null, dirty: true, handEditRecords: [] });
  assert.equal('at' in playing, false);
  assert.equal(playing.dirty, true);
});

test('non-text inputs do not count as text-entry controls for shortcuts or undo', () => {
  for (const type of ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']) {
    assert.equal(isTextEntryTarget({ tagName: 'INPUT', type }), false, type);
    assert.ok(TEXT_ENTRY_SELECTOR.includes(`:not([type="${type}"])`), type);
  }
  for (const type of ['text', 'search', 'number', 'email', 'url']) {
    assert.equal(isTextEntryTarget({ tagName: 'INPUT', type }), true, type);
  }
  assert.equal(isTextEntryTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTextEntryTarget({ tagName: 'BUTTON' }), false);
});
