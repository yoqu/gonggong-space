import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playSeconds } from '@open-artifact/motion-core';
import { FrameRenderError } from '../src/errors.ts';
import { renderExportFrames } from '../src/frames.ts';
import { failedProblem, heldProblem } from '../src/problems.ts';
import type { ExportFrame } from '../src/types.ts';

const page = { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as Document;
const fakeBitmap = (): ImageBitmap => ({ close: () => undefined }) as unknown as ImageBitmap;
const plan = { width: 4, height: 4, fps: 10, frames: 5 };

test('held frames are counted, with the first and the last, and the export goes on', async () => {
  const frame: ExportFrame = (t) => (t === 0.2 || t === 0.3 ? Promise.reject(new FrameRenderError('no ' + t, t)) : Promise.resolve(fakeBitmap()));
  const drawn: Array<boolean> = [];
  const held = await renderExportFrames({
    plan,
    frame,
    scale: 1,
    page,
    stalls: 0,
    draw: (bitmap) => drawn.push(bitmap !== null),
    commit: () => undefined,
  });
  assert.deepEqual(drawn, [true, true, false, false, true]);
  assert.equal(held.count, 2);
  assert.equal(held.total, 5);
  assert.deepEqual(held.first, { t: 0.2, message: 'no 0.2' });
  assert.equal(held.last, 0.3);
  const problem = heldProblem(held, true);
  assert.deepEqual(problem, { kind: 'held', count: 2, total: 5, first: { t: 0.2, message: 'no 0.2' }, last: 0.3, saved: true });
});

test('every frame held stops the export', async () => {
  const frame: ExportFrame = (t) => Promise.reject(new FrameRenderError('broken', t));
  await assert.rejects(
    renderExportFrames({ plan, frame, scale: 1, page, stalls: 0, draw: () => undefined, commit: () => undefined }),
    (error: unknown) => error instanceof FrameRenderError && !error.hold && /No frame could be rendered/.test(error.message),
  );
});

test('a frame that cannot be held stops the export, and is the film’s problem', async () => {
  const frame: ExportFrame = (t) => (t > 0 ? Promise.reject(new FrameRenderError('scene threw', t, false)) : Promise.resolve(fakeBitmap()));
  const error = await renderExportFrames({ plan, frame, scale: 1, page, stalls: 0, draw: () => undefined, commit: () => undefined }).then(
    () => null,
    (reason: unknown) => reason,
  );
  assert.deepEqual(failedProblem(error), { kind: 'failed', t: 0.1, message: 'scene threw' });
});

test('an export with no held frame has no problem; other failures are not the film’s', () => {
  assert.equal(heldProblem({ count: 0, total: 5 }, true), null);
  assert.equal(failedProblem(new Error('encoder')), null);
});

test('a held frame’s message is cut for the agent', () => {
  const problem = heldProblem({ count: 1, total: 1, first: { t: playSeconds(0), message: 'x'.repeat(5000) } }, false);
  assert.ok(problem !== null && problem.kind === 'held' && problem.first !== undefined && problem.first.message.length < 5000);
});

test('the export stops when it is cancelled', async () => {
  const controller = new AbortController();
  const frame: ExportFrame = () => Promise.resolve(fakeBitmap());
  await assert.rejects(
    renderExportFrames({
      plan,
      frame,
      scale: 1,
      page,
      stalls: 0,
      signal: controller.signal,
      draw: () => undefined,
      commit: (index) => {
        if (index === 1) controller.abort();
      },
    }),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});
