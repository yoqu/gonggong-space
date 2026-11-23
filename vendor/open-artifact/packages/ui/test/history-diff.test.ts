import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffHunks, diffLines, diffStats, groupVersions } from '../src/history-diff.ts';

const ops = (before: string | null, after: string | null): string =>
  diffLines(before, after)
    .map((l) => `${l.op}${l.text}`)
    .join('|');

describe('diffLines', () => {
  it('keeps, removes and adds lines in order, with line numbers', () => {
    assert.equal(ops('a\nb\nc\n', 'a\nB\nc\nd\n'), ' a|-b|+B| c|+d');
    const lines = diffLines('a\nb\n', 'b\nc\n');
    assert.deepEqual(lines, [
      { op: '-', text: 'a', before: 1 },
      { op: ' ', text: 'b', before: 2, after: 1 },
      { op: '+', text: 'c', after: 2 },
    ]);
    assert.deepEqual(diffStats(lines), { removed: 1, added: 1 });
  });

  it('treats a missing file as empty', () => {
    assert.equal(ops(null, 'x\ny'), '+x|+y');
    assert.equal(ops('x\n', null), '-x');
    assert.equal(ops('same', 'same'), ' same');
  });
});

describe('diffHunks', () => {
  it('shows changes with three lines of context and joins close ones', () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n');
    const after = before.replace('l5\n', 'L5\n').replace('l8\n', 'L8\n').replace('l25\n', 'L25\n');
    const hunks = diffHunks(diffLines(before, after));
    assert.equal(hunks.length, 2);
    assert.equal(hunks[0]!.skippedBefore, 1);
    assert.equal(hunks[0]!.lines[0]!.text, 'l2');
    assert.equal(hunks[1]!.lines[0]!.text, 'l22');
    assert.equal(hunks[1]!.lines.at(-1)!.text, 'l28');
    assert.deepEqual(diffHunks(diffLines('a', 'a')), []);
  });
});

describe('groupVersions', () => {
  it('groups by local day, then runs of one author; a restore stands alone', () => {
    const v = (n: number, at: string, id: string, restoredFrom?: number) => ({
      n,
      at: new Date(at).toISOString(),
      author: { kind: id === 'agent' ? 'agent' : 'person', id },
      ...(restoredFrom ? { restoredFrom } : {}),
    });
    const days = groupVersions([
      v(6, '2026-11-16T15:00', 'ada'),
      v(5, '2026-11-16T14:00', 'ada', 2),
      v(4, '2026-11-16T13:00', 'ada'),
      v(3, '2026-11-16T12:00', 'ada'),
      v(2, '2026-11-16T11:00', 'agent'),
      v(1, '2026-11-15T09:00', 'agent'),
    ]);
    assert.deepEqual(
      days.map((d) => [d.key, d.runs.map((r) => r.versions.map((x) => x.n))]),
      [
        ['2026-11-16', [[6], [5], [4, 3], [2]]],
        ['2026-11-15', [[1]]],
      ],
    );
  });
});
