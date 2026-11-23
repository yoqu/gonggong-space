/**
 * Find in page (⌘F): folding and matching text (`find/find-text.ts`), the
 * runs of drawn text a walk builds, the keys, the counter, and the
 * controller that searches, steps and reveals (`find/find-controller.ts`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFindController, type FindAdapter, type FindMatch } from '../src/find/find-controller.ts';
import {
  createFindRunBuilder,
  EMPTY_FIND_STATUS,
  findCountMessage,
  findCountText,
  findOffsets,
  findStepDirection,
  findStepDisabledTip,
  foldForFind,
  isFindShortcut,
  matchesInRun,
  MAX_FIND_MATCHES,
  NO_MATCHES_LABEL,
  ownsFindStepChord,
  steadyFindStatus,
  TYPE_TO_SEARCH_LABEL,
  whiteSpaceMode,
  type FindKeyPress,
  type FindStatus,
  type FindTextRun,
} from '../src/find/find-text.ts';

const key = (over: Partial<FindKeyPress>): FindKeyPress => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });

/** Builds the runs of some `[node, text, mode]` pieces, `null` ending a run. */
function runsOf(pieces: Array<[string, string, ReturnType<typeof whiteSpaceMode>] | null>): FindTextRun<string>[] {
  const runs: FindTextRun<string>[] = [];
  const builder = createFindRunBuilder<string>((run) => {
    runs.push(run);
    return true;
  });
  for (const piece of pieces) {
    if (piece === null) builder.end();
    else builder.add(piece[0], piece[1], piece[2]);
  }
  builder.end();
  return runs;
}

describe('find text', () => {
  it('folds case, odd spaces, final sigma and curly quotes, keeping offsets', () => {
    assert.equal(foldForFind('Don’t Stop'), "don't stop");
    assert.equal(foldForFind('ΟΔΟΣ'), 'οδοσ');
    assert.equal(foldForFind('οδος'), 'οδοσ');
    const astral = 'a😀B';
    assert.equal(foldForFind(astral).length, astral.length);
  });

  it('finds every match, case-blind and not overlapping', () => {
    assert.deepEqual(findOffsets('Plan the plan, PLAN', 'plan'), [0, 9, 15]);
    assert.deepEqual(findOffsets('aaaa', 'aa'), [0, 2]);
    assert.deepEqual(findOffsets('anything', ''), []);
    assert.deepEqual(findOffsets('“quoted”', '"quoted"'), [0]);
  });

  it('reads white-space modes', () => {
    assert.equal(whiteSpaceMode('normal', false), 'all');
    assert.equal(whiteSpaceMode('pre-line', false), 'keep-newlines');
    assert.equal(whiteSpaceMode('pre-wrap', false), 'none');
    assert.equal(whiteSpaceMode('', true), 'none');
    assert.equal(whiteSpaceMode('', false), 'all');
  });

  it('collapses spaces the way they are drawn and ends runs at blocks', () => {
    const runs = runsOf([['a', '  Hello   ', 'all'], ['b', ' world ', 'all'], null, ['c', 'Next', 'all']]);
    assert.deepEqual(
      runs.map((run) => run.text),
      ['Hello world', 'Next'],
    );
    const [first] = runs;
    assert.ok(first);
    // "w" of "world" comes from node b, offset 1.
    const at = first.text.indexOf('w');
    assert.equal(first.nodes[first.nodeAt[at]!], 'b');
    assert.equal(first.offsetAt[at], 1);
  });

  it('keeps pre text as written', () => {
    const [run] = runsOf([['p', 'a  b\n c', 'none']]);
    assert.equal(run?.text, 'a  b\n c');
  });

  it('matches across text nodes, with the query collapsed in collapsing runs', () => {
    const [run] = runsOf([['a', 'big   red', 'all'], ['b', ' dog', 'all']]);
    assert.ok(run);
    const matches = matchesInRun(run, 'red  dog');
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0], { start: { node: 'a', offset: 6 }, end: { node: 'b', offset: 4 } });
    assert.equal(matchesInRun(run, 'big', 0).length, 0);
  });

  it('stops walking when a run says so', () => {
    let seen = 0;
    const builder = createFindRunBuilder<string>(() => {
      seen++;
      return false;
    });
    builder.add('a', 'one', 'all');
    builder.end();
    assert.equal(builder.going, false);
    builder.add('b', 'two', 'all');
    builder.end();
    assert.equal(seen, 1);
  });
});

describe('find keys', () => {
  it('opens on ⌘F on Apple platforms and Ctrl+F elsewhere', () => {
    assert.equal(isFindShortcut(key({ key: 'f', metaKey: true }), true), true);
    assert.equal(isFindShortcut(key({ key: 'f', ctrlKey: true }), true), false);
    assert.equal(isFindShortcut(key({ key: 'f', ctrlKey: true }), false), true);
    assert.equal(isFindShortcut(key({ key: 'а', code: 'KeyF', metaKey: true }), true), true);
    assert.equal(isFindShortcut(key({ key: 'f', metaKey: true, shiftKey: true }), true), false);
    assert.equal(isFindShortcut(key({ key: 'f', metaKey: true, altKey: true }), true), false);
  });

  it('steps on ⌘G / ⇧⌘G and F3 / ⇧F3', () => {
    assert.equal(findStepDirection(key({ key: 'g', metaKey: true }), true), 1);
    assert.equal(findStepDirection(key({ key: 'G', metaKey: true, shiftKey: true }), true), -1);
    assert.equal(findStepDirection(key({ key: 'F3' }), false), 1);
    assert.equal(findStepDirection(key({ key: 'F3', shiftKey: true }), false), -1);
    assert.equal(findStepDirection(key({ key: 'F3', ctrlKey: true }), false), undefined);
    assert.equal(findStepDirection(key({ key: 'g' }), true), undefined);
  });

  it('leaves ⌘G to grouping while items are selected on an editable board', () => {
    const chord = key({ key: 'g', metaKey: true });
    assert.equal(ownsFindStepChord(chord, { selected: 2, editable: true, typing: false }), false);
    assert.equal(ownsFindStepChord(chord, { selected: 2, editable: true, typing: true }), true);
    assert.equal(ownsFindStepChord(chord, { selected: 0, editable: true, typing: false }), true);
    assert.equal(ownsFindStepChord(chord, { selected: 2, editable: false, typing: false }), true);
    assert.equal(ownsFindStepChord(key({ key: 'F3' }), { selected: 2, editable: true, typing: false }), true);
  });
});

describe('find counter', () => {
  const status = (over: Partial<FindStatus>): FindStatus => ({ ...EMPTY_FIND_STATUS, ...over });

  it('counts matches, with + past the cap', () => {
    assert.equal(findCountText(status({ query: 'a', total: 12, current: 3 })), '3/12');
    assert.equal(findCountText(status({ query: 'a', total: 1000, current: 3, capped: true })), '3/1000+');
    assert.equal(findCountText(status({ query: 'a', searching: true })), '');
    assert.equal(findCountText(EMPTY_FIND_STATUS), '');
    assert.equal(findCountMessage(3, 12, false), '3 of 12');
    assert.equal(findCountMessage(3, 1000, true), '3 of 1000 or more');
    assert.equal(findCountMessage(0, 0, false), NO_MATCHES_LABEL);
  });

  it('says why stepping is off', () => {
    assert.equal(findStepDisabledTip(EMPTY_FIND_STATUS), TYPE_TO_SEARCH_LABEL);
    assert.equal(findStepDisabledTip(status({ query: 'x' })), NO_MATCHES_LABEL);
    assert.equal(findStepDisabledTip(status({ query: 'x', searching: true })), undefined);
  });

  it('keeps the settled count while the next search runs', () => {
    let current = status({ query: 'ab', total: 4, current: 1 });
    const read = steadyFindStatus(() => current);
    assert.equal(read(), current);
    const settled = current;
    current = status({ query: 'abc', searching: true });
    assert.equal(read(), settled);
    current = EMPTY_FIND_STATUS;
    assert.equal(read(), EMPTY_FIND_STATUS);
  });
});

/** A fake page: items with words, recording reveals and paints. */
function fakePage(items: Record<string, string>) {
  const words = new Map(Object.entries(items));
  const revealed: string[] = [];
  const painted: Array<{ count: number; current: number }> = [];
  let notify: (() => void) | undefined;
  let cleared = 0;
  const adapter: FindAdapter = {
    search(query) {
      const matches: FindMatch[] = [];
      for (const [id, text] of words) findOffsets(text, query).forEach((_, nth) => matches.push({ key: `${id}|${nth}`, id, nth }));
      return matches;
    },
    async reveal(match) {
      if (!words.has(match.id)) return false;
      revealed.push(match.key);
      return undefined;
    },
    paint(matches, current) {
      painted.push({ count: matches.length, current });
    },
    clear() {
      cleared++;
    },
    subscribe(listener) {
      notify = listener;
      return () => (notify = undefined);
    },
  };
  return {
    adapter,
    words,
    revealed,
    painted,
    cleared: () => cleared,
    change: () => notify?.(),
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('find controller', () => {
  it('searches, reveals the first match and steps around both ways', async () => {
    const page = fakePage({ a: 'red apple, red', b: 'blue', c: 'red' });
    const find = createFindController(page.adapter, { debounceMs: 0 });
    find.setQuery('red');
    await settle();
    assert.deepEqual(find.status(), { query: 'red', total: 3, current: 1, capped: false, searching: false });
    assert.deepEqual(page.revealed, ['a|0']);
    find.step(1);
    await settle();
    find.step(1);
    await settle();
    assert.equal(find.status().current, 3);
    find.step(1);
    await settle();
    assert.equal(find.status().current, 1);
    find.step(-1);
    await settle();
    assert.equal(find.status().current, 3);
    assert.deepEqual(page.revealed, ['a|0', 'a|1', 'c|0', 'a|0', 'c|0']);
    find.dispose();
  });

  it('keeps the current match when the board changes under it', async () => {
    const page = fakePage({ a: 'cat', b: 'cat', c: 'cat' });
    const find = createFindController(page.adapter, { debounceMs: 0 });
    find.setQuery('cat');
    await settle();
    find.step(1);
    await settle();
    assert.equal(find.status().current, 2);
    page.words.delete('a');
    page.change();
    await settle();
    assert.deepEqual(find.status(), { query: 'cat', total: 2, current: 1, capped: false, searching: false });
    assert.equal(page.revealed.length, 2, 'a re-search does not move the view');
    find.dispose();
  });

  it('drops a match that is gone when stepping to it', async () => {
    const page = fakePage({ a: 'dog', b: 'dog', c: 'dog' });
    const find = createFindController(page.adapter, { debounceMs: 0 });
    find.setQuery('dog');
    await settle();
    page.words.delete('b');
    find.step(1);
    await settle();
    assert.equal(find.status().total, 2);
    assert.equal(page.revealed.at(-1), 'c|0');
    find.dispose();
  });

  it('caps the count', async () => {
    const page = fakePage({ a: 'x'.repeat(MAX_FIND_MATCHES + 5) });
    const find = createFindController(page.adapter, { debounceMs: 0 });
    find.setQuery('x');
    await settle();
    assert.equal(find.status().total, MAX_FIND_MATCHES);
    assert.equal(find.status().capped, true);
    find.dispose();
  });

  it('waits for typing to settle, and a step searches at once', async () => {
    const page = fakePage({ a: 'moon' });
    const find = createFindController(page.adapter, { debounceMs: 10_000 });
    find.setQuery('mo');
    assert.equal(find.status().searching, true);
    find.step(1);
    await settle();
    assert.deepEqual(find.status(), { query: 'mo', total: 1, current: 1, capped: false, searching: false });
    find.dispose();
  });

  it('clears on an empty query and stops after dispose', async () => {
    const page = fakePage({ a: 'sun' });
    const find = createFindController(page.adapter, { debounceMs: 0 });
    find.setQuery('sun');
    await settle();
    find.setQuery('');
    assert.equal(find.status(), EMPTY_FIND_STATUS);
    assert.ok(page.cleared() >= 1);
    find.dispose();
    find.setQuery('sun');
    assert.equal(find.status(), EMPTY_FIND_STATUS);
  });
});
