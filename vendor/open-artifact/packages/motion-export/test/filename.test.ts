import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALLBACK_FILE_STEM, downloadFileName, exportFileStem, exportFilename } from '../src/filename.ts';

test('a title becomes a lower-case stem of letters and digits joined by dashes', () => {
  assert.equal(exportFileStem('  My Launch Video: Part 2!  '), 'my-launch-video-part-2');
});

test('accents are dropped to their plain letters', () => {
  assert.equal(exportFileStem('Café Crème'), 'cafe-creme');
});

test('a title with no plain letters falls back', () => {
  assert.equal(exportFileStem('视频'), FALLBACK_FILE_STEM);
  assert.equal(exportFileStem('---'), FALLBACK_FILE_STEM);
});

test('a long title is cut to 60 characters without a trailing dash', () => {
  const stem = exportFileStem('word '.repeat(40));
  assert.ok(stem.length <= 60);
  assert.ok(!stem.endsWith('-'));
  assert.ok(stem.startsWith('word-word'));
});

test('an exported file keeps the title: case, any script and spaces', () => {
  assert.equal(exportFilename('Hello World', 'mp4'), 'Hello World.mp4');
  assert.equal(exportFilename('Café Crème', 'mov'), 'Café Crème.mov');
  assert.equal(exportFilename('发布会 视频', 'gif'), '发布会 视频.gif');
  assert.equal(exportFilename('Launch 🚀 Day', 'html'), 'Launch 🚀 Day.html');
  assert.equal(downloadFileName('Hello World', 'zip'), exportFilename('Hello World', 'zip'));
});

test('characters a file system refuses become a space, a run of them one space', () => {
  assert.equal(downloadFileName('My Launch Video: Part 2!', 'mp4'), 'My Launch Video Part 2!.mp4');
  assert.equal(downloadFileName('a/b\\c:d*e?f"g<h>i|j%k', 'mp4'), 'a b c d e f g h i j k.mp4');
  assert.equal(downloadFileName('Q3 // <draft>?', 'mp4'), 'Q3 draft.mp4');
  assert.equal(downloadFileName('A <b>bold</b> "film"', 'html'), 'A b bold b film.html');
});

test('tabs and line breaks are spaces, and whitespace runs collapse', () => {
  assert.equal(downloadFileName('one\ttwo\r\nthree   four 　five', 'mp4'), 'one two three four five.mp4');
});

test('control, format and invisible characters are left out', () => {
  assert.equal(downloadFileName('a\u0000b\u0007c\u001fd\u007fe\u0085f\u009fg', 'mp4'), 'abcdefg.mp4');
  // Zero-width space, joiners, bidi marks and isolates, soft hyphen, word joiner, byte order mark: format characters.
  assert.equal(downloadFileName('a​b‌c‍d‎e‮f⁦g­h⁠i﻿j', 'mp4'), 'abcdefghij.mp4');
  // Default-ignorable: the Hangul filler and a variation selector.
  assert.equal(downloadFileName('aㅤb️c\u{e0100}d', 'mp4'), 'abcd.mp4');
  // Line and paragraph separators, lone surrogates.
  assert.equal(downloadFileName('a b c\ud800d\udc00e', 'mp4'), 'abcde.mp4');
  // The blank Braille pattern, the object replacement character, hieroglyph format controls, the null notehead.
  assert.equal(downloadFileName('a⠀b￼c\u{13441}d\u{13442}e\u{1d159}f', 'mp4'), 'abcdef.mp4');
});

test('leading and trailing dots and spaces go; inner dots stay', () => {
  assert.equal(downloadFileName('..hidden', 'mp4'), 'hidden.mp4');
  assert.equal(downloadFileName(' . v1.2 final. . ', 'mp4'), 'v1.2 final.mp4');
  assert.equal(downloadFileName('name...', 'mp4'), 'name.mp4');
});

test('a long title is cut to 120 code points, then trailing dots and spaces go again', () => {
  assert.equal(downloadFileName('x'.repeat(300), 'mp4'), 'x'.repeat(120) + '.mp4');
  const emoji = downloadFileName('😀'.repeat(130), 'mp4');
  assert.equal(emoji, '😀'.repeat(120) + '.mp4');
  assert.equal(downloadFileName('x'.repeat(118) + ' .' + 'y'.repeat(10), 'mp4'), 'x'.repeat(118) + '.mp4');
});

test('a title with nothing left is named video', () => {
  assert.equal(downloadFileName('', 'gif'), 'video.gif');
  assert.equal(downloadFileName(' \u0000 ', 'mp4'), 'video.mp4');
  assert.equal(downloadFileName('...', 'mp4'), 'video.mp4');
  assert.equal(downloadFileName('???', 'mp4'), 'video.mp4');
  assert.equal(downloadFileName('​⠀', 'mp4'), 'video.mp4');
});
