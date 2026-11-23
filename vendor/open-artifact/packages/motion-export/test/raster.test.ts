import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inScript, rasterDocument } from '../src/raster/document.ts';
import { isRasterRequest, readRasterReply } from '../src/raster/messages.ts';

test('a script cannot end its element nor open a comment', () => {
  assert.equal(inScript('a</script>b</SCRIPT>'), 'a<\\/script>b<\\/SCRIPT>');
  assert.equal(inScript('x<!--y'), 'x<\\x21--y');
  const page = rasterDocument('"</script><img src=x>"');
  assert.equal(page.match(/<\/script/gi)?.length, 1);
  assert.ok(page.includes("default-src 'none'"));
});

test('a raster request needs a number id, the SVG and its size', () => {
  assert.equal(isRasterRequest({ rid: 1, svg: '<svg/>', pw: 2, ph: 2 }), true);
  assert.equal(isRasterRequest({ rid: 1, svg: '<svg/>', pw: 2, ph: 2, waitMs: 10 }), true);
  assert.equal(isRasterRequest({ rid: 1, svg: '<svg/>', pw: 2, ph: 2, waitMs: '10' }), false);
  assert.equal(isRasterRequest({ rid: Number.NaN, svg: '<svg/>', pw: 2, ph: 2 }), false);
  assert.equal(isRasterRequest({ rid: 1, pw: 2, ph: 2 }), false);
  assert.equal(isRasterRequest([1]), false);
  assert.equal(isRasterRequest(null), false);
});

test('a reply is read as ready, an error with its request, or nothing', () => {
  assert.deepEqual(readRasterReply({ rasterReady: true }), { kind: 'ready' });
  assert.deepEqual(readRasterReply({ rid: 4, error: 'boom' }), { kind: 'error', rid: 4, message: 'boom' });
  assert.deepEqual(readRasterReply({ rid: 4 }), { kind: 'error', rid: 4, message: 'raster failed' });
  assert.equal(readRasterReply({ rid: 4, error: 'x'.repeat(1000) }).kind, 'error');
  const long = readRasterReply({ rid: 4, error: 'x'.repeat(1000) });
  assert.ok(long.kind === 'error' && long.message.length === 300);
  assert.deepEqual(readRasterReply({ rid: 'no' }), { kind: 'other' });
  assert.deepEqual(readRasterReply('hello'), { kind: 'other' });
});
