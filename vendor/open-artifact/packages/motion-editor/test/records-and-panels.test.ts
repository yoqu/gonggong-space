import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FilmModule } from '@open-artifact/motion-core';
import { applyFilmRecords } from '../src/engine/applied-film.ts';
import { EndedLinesWatch } from '../src/engine/ended-lines.ts';
import { asksForFetchedFonts, filmStageFaces, type FilmFontsIo } from '../src/engine/film-faces.ts';
import { UndoStack } from '../src/engine/undo-stack.ts';
import { givesWayTo, panelToggleAnnouncement, panelView, PROPERTIES_AND_THEME, type PanelContent } from '../src/panels/panel-view.ts';
import { KEEPS_PICK, pressLetsGo } from '../src/layers/press-away.ts';
import { themeContent } from '../src/style/theme-content.ts';
import { advanceEstimate, roundEtaMinutes, timeLeft, timeLeftWords } from '../src/player/work-estimate.ts';

const json = (name: string, value: unknown): FilmModule => ({ name, kind: 'json', text: JSON.stringify(value) });
const SCRIPT = "const title = 'Hello there world'; ctx.fillStyle = '#ff0000';";

test('retyped lines and colors are written into the code the stage runs', () => {
  const applied = applyFilmRecords(
    { script: SCRIPT, modules: [json('scenes.json', { v: 1, background: '#ff0000', scenes: [] })] },
    { retyped: { lines: [{ was: 'Hello there world', v: 'Hi all' }, { was: 'Gone words here', v: 'x' }] }, recolored: { colors: [{ was: '#ff0000', v: '#00ff00' }] } },
  );
  assert.equal(applied.script, "const title = 'Hi all'; ctx.fillStyle = '#00ff00';");
  assert.equal(applied.swapped, 1);
  assert.deepEqual(applied.unmatchedLines.map((line) => line.was), ['Gone words here']);
  assert.match(applied.modules[0]!.text, /#00ff00/);
  assert.deepEqual(applied.warnings, []);
});

test('no records leave the film as it is', () => {
  const modules = [json('scenes.json', { v: 1, scenes: [] })];
  const applied = applyFilmRecords({ script: SCRIPT, modules }, { retyped: null, recolored: null });
  assert.equal(applied.script, SCRIPT);
  assert.equal(applied.modules[0], modules[0]);
});

const io = (loaded: string[]): FilmFontsIo => ({
  builtin: async (file) => (loaded.push(file), 'data:font/woff2;base64,AAAA'),
  fetcher: () => undefined,
  stored: async () => null,
});

test('a film naming built-in typefaces gets their faces as data URIs', async () => {
  const loaded: string[] = [];
  const modules = [json('scenes.json', { v: 1, fonts: { sans: 'plus-jakarta-sans' } })];
  assert.equal(asksForFetchedFonts(modules), false);
  const result = await filmStageFaces("text('Hello')", modules, io(loaded));
  assert.ok(result.faces !== null);
  assert.ok(result.faces.slots.sans !== undefined);
  assert.ok(result.faces.fonts.length > 0);
  assert.ok(result.faces.fonts.every((face) => face.url === 'data:font/woff2;base64,AAAA' && Array.isArray(face.box)));
  assert.ok(loaded.some((file) => file.startsWith('PlusJakartaSans')));
});

test('a film without fonts has no faces, and a Google family asks for fetched fonts', async () => {
  const none = await filmStageFaces('', [json('scenes.json', { v: 1 })], io([]));
  assert.equal(none.faces, null);
  assert.equal(asksForFetchedFonts([json('scenes.json', { v: 1, fonts: { sans: { family: 'Lobster', or: 'manrope' } } })]), true);
});

test('the undo stack undoes, redoes, and forgets the redo on a new change', () => {
  const log: string[] = [];
  const stack = new UndoStack(2);
  const entry = (name: string) => ({ label: name, undo: () => log.push(`undo ${name}`), redo: () => log.push(`redo ${name}`) });
  assert.equal(stack.undo(), null);
  stack.push(entry('a'));
  stack.push(entry('b'));
  stack.push(entry('c'));
  assert.equal(stack.undo()?.label, 'c');
  assert.equal(stack.undo()?.label, 'b');
  assert.equal(stack.undo(), null, 'only two are kept');
  assert.equal(stack.redo()?.label, 'b');
  stack.push(entry('d'));
  assert.equal(stack.canRedo, false);
  assert.deepEqual(log, ['undo c', 'undo b', 'redo b']);
});

test('Properties and Theme show as tabs of one panel; others alone', () => {
  const tweaks = { id: 'tweaks', label: 'Properties' };
  const style = { id: 'style', label: 'Theme' };
  const other = { id: 'export', label: 'Export' };
  assert.equal(panelView(null, [tweaks, style]), null);
  const view = panelView('style', [tweaks, style, other]);
  assert.deepEqual(view, { kind: 'tabs', title: PROPERTIES_AND_THEME.title, tabs: [tweaks, style], active: style, out: [] });
  // A group of one tab is named after it.
  assert.deepEqual(panelView('style', [tweaks]), { kind: 'tabs', title: 'Properties', tabs: [tweaks], active: tweaks, out: [] });
  assert.deepEqual(panelView('export', [tweaks, other]), { kind: 'single', panel: other });
  assert.equal(panelView('layers', [tweaks]), null);
});

test('Theme is listed while it has something; while it waits, only when open; with nothing, it gives way', () => {
  const tweaks = { id: 'tweaks', label: 'Properties' };
  const style = { id: 'style', label: 'Theme' };
  const shown = [tweaks, style];
  const says =
    (theme: PanelContent) =>
    (id: string): PanelContent =>
      id === 'style' ? theme : 'has';
  assert.deepEqual(panelView('tweaks', shown, says('has')), { kind: 'tabs', title: 'Properties and Theme', tabs: [tweaks, style], active: tweaks, out: [] });
  // Waiting (no animation yet, previews being drawn, the agent at work): kept while open, left out otherwise.
  assert.deepEqual(panelView('style', shown, says('wait')), { kind: 'tabs', title: 'Properties and Theme', tabs: [tweaks, style], active: style, out: [] });
  assert.deepEqual(panelView('tweaks', shown, says('wait')), { kind: 'tabs', title: 'Properties', tabs: [tweaks], active: tweaks, out: [style] });
  // Nothing to show: left out, and the open Theme tab gives way to Properties.
  const none = panelView('style', shown, says('none'));
  assert.deepEqual(none, { kind: 'tabs', title: 'Properties', tabs: [tweaks], active: tweaks, out: [style] });
  assert.equal(givesWayTo('style', none, says('none')), 'tweaks');
  assert.equal(givesWayTo('tweaks', none, says('none')), null);
  assert.equal(givesWayTo('style', panelView('style', shown, says('wait')), says('wait')), null);
  assert.equal(givesWayTo(null, null, says('none')), null);
});

test('opening and closing the side panel announces its name, while switching tabs stays quiet', () => {
  assert.equal(panelToggleAnnouncement(null, 'Properties'), 'Properties opened');
  assert.equal(panelToggleAnnouncement(null, 'Properties and Theme'), 'Properties and Theme opened');
  assert.equal(panelToggleAnnouncement('Properties', 'Properties and Theme'), null);
  assert.equal(panelToggleAnnouncement('Properties and Theme', 'Properties'), null);
  assert.equal(panelToggleAnnouncement('Properties', null), 'Properties closed');
  assert.equal(panelToggleAnnouncement('Properties and Theme', null), 'Properties and Theme closed');
  assert.equal(panelToggleAnnouncement(null, null), null);
});

test('the Theme tab has its sections, waits, or has nothing', () => {
  const base = { hasScript: true, stopped: false, sections: false, looking: false, working: false };
  assert.equal(themeContent({ ...base, sections: true }), 'has');
  assert.equal(themeContent({ ...base, sections: true, looking: true }), 'has');
  assert.equal(themeContent(base), 'none');
  assert.equal(themeContent({ ...base, looking: true }), 'wait');
  assert.equal(themeContent({ ...base, working: true }), 'wait');
  assert.equal(themeContent({ ...base, hasScript: false }), 'wait');
  assert.equal(themeContent({ ...base, stopped: true, sections: true }), 'wait');
});

test('a press away from the picture, the panel and the controls lets the pick go', () => {
  // A stand-in element: inside the parts named by `within`.
  const at = (...within: string[]) => ({
    closest: (selectors: string) => (within.some((part) => selectors.split(', ').includes(part)) ? {} : null),
  });
  assert.equal(pressLetsGo({ button: 0, target: at() }, false), true);
  for (const part of ['[data-video-stage]', '[data-video-stage-overlay]', '[data-video-panel]', 'button', 'input', '[role="slider"]', '[role="tab"]']) {
    assert.ok(KEEPS_PICK.split(', ').includes(part), part);
    assert.equal(pressLetsGo({ button: 0, target: at(part) }, false), false, part);
  }
  // Not the main button, an open menu or dialog, or no element: the pick stays.
  assert.equal(pressLetsGo({ button: 2, target: at() }, false), false);
  assert.equal(pressLetsGo({ button: 0, target: at() }, true), false);
  assert.equal(pressLetsGo({ button: 0, target: null }, false), false);
});

test('lines an agent turn rewrote are found after the turn', () => {
  const watch = new EndedLinesWatch();
  const lines = [{ was: 'Fast cars', v: 'Quick trains' }];
  const before = { script: "const a = 'Fast cars';", modules: [json('retyped.json', { v: 1, lines })] };
  const after = { script: "const a = 'Fast cars are lovely to watch';", modules: before.modules };
  assert.deepEqual(watch.film({ film: before, lines }, 0), []);
  watch.activity(true, 10);
  assert.deepEqual(watch.film({ film: after, lines }, 20), [], 'nothing while the agent works');
  watch.activity(false, 30);
  const ended = watch.film({ film: after, lines }, 30);
  assert.equal(ended.length, 1);
  assert.equal(ended[0]!.v, 'Quick trains');
  assert.equal(ended[0]!.now, 'Fast cars are lovely to watch');
});

test('a change by the person (no turn) ends no line', () => {
  const watch = new EndedLinesWatch();
  const lines = [{ was: 'Fast cars', v: 'Quick trains' }];
  watch.film({ film: { script: "const a = 'Fast cars';", modules: [] }, lines }, 0);
  assert.deepEqual(watch.film({ film: { script: "const a = 'Fast cars are lovely to watch';", modules: [] }, lines }, 5), []);
});

test('time left: a usual range first, then the scenes own pace, then late', () => {
  let estimate = advanceEstimate(null, { what: 'making', toCome: 4, of: 4 }, 0)!;
  const first = timeLeft(estimate, 1000);
  assert.equal(first.kind, 'usual');
  assert.match(timeLeftWords(first), /^usually \d+ to \d+ min$/);
  estimate = advanceEstimate(estimate, { what: 'making', toCome: 3, of: 4 }, 60_000)!;
  assert.equal(estimate.timed, 1);
  const left = timeLeft(estimate, 60_000);
  assert.equal(left.kind, 'left');
  assert.match(timeLeftWords(left), /^about \d+ min left$/);
  assert.equal(timeLeft(estimate, 60_000 + 3_600_000).kind, 'late');
  assert.equal(advanceEstimate(estimate, null, 1), null);
  assert.equal(roundEtaMinutes(30), 0);
  assert.equal(timeLeftWords({ kind: 'left', minutes: 0 }), 'Finishing up');
});
