/**
 * Tests of text files attached to an Ask request: cleaning names and text,
 * telling text from binary, the 40 KB budget, a request taking the files
 * (and a failed one giving them back), files read while a request went,
 * and how a drop on the board offers its text files to the Ask panel.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  ATTACHED_FILES_MAX_BYTES,
  ATTACHED_FILE_NAME_MAX,
  ATTACHED_FILE_READ_MAX,
  attachFiles,
  attachedFileBytes,
  attachedFilesContext,
  clipAttachedFileName,
  clipboardTextIsFileNames,
  decodeTextFileBytes,
  dropAttachedFile,
  giveBackAttachedFiles,
  looksLikeLatin1Text,
  normalizeAttachedFileText,
  offerTextFiles,
  quotedNameList,
  resetAttachedFiles,
  stripInvisibleChars,
  takeAttachedFiles,
  unsupportedDropMessage,
  useAttachedFiles,
  type AttachHost,
} from '../src/collab/attached-files.ts';

const textFile = (name: string, text: string, type = 'text/plain'): File => new File([text], name, { type });
const names = (): string[] => useAttachedFiles.getState().files.map((file) => file.name);

/** A host that records what offering did. */
function fakeHost(canAsk: boolean, open = false): AttachHost & { toasts: string[]; spoken: string[]; opened: number } {
  const host = {
    toasts: [] as string[],
    spoken: [] as string[],
    opened: 0,
    canAsk: () => canAsk,
    isOpen: () => open,
    open: () => {
      host.opened += 1;
      open = true;
    },
    toast: (message: string) => void host.toasts.push(message),
    announce: (message: string) => void host.spoken.push(message),
  };
  return host;
}

beforeEach(() => resetAttachedFiles());

describe('cleaning names and text', () => {
  it('drops invisible characters but keeps line breaks, joiners in emoji and odd whitespace as spaces', () => {
    assert.equal(stripInvisibleChars('a​b⁠c'), 'abc');
    assert.equal(stripInvisibleChars('one\r\ntwo'), 'one\ntwo');
    assert.equal(stripInvisibleChars('a\tb\fc'), 'a b c');
    const family = '👩‍👩‍👧';
    assert.equal(stripInvisibleChars(family), family);
    assert.equal(stripInvisibleChars('‍word'), 'word');
  });

  it('collapses whitespace in a name and clips a long one in the middle', () => {
    assert.equal(clipAttachedFileName('  sales​  report\n.csv '), 'sales report .csv');
    const long = `${'a'.repeat(150)}.csv`;
    const clipped = clipAttachedFileName(long);
    assert.equal([...clipped].length, ATTACHED_FILE_NAME_MAX);
    assert.ok(clipped.includes('…'));
    assert.ok(clipped.endsWith('.csv'));
  });

  it('normalizes line breaks and keeps tabs between columns', () => {
    assert.equal(normalizeAttachedFileText('a\tb\r\nc\td\re'), 'a\tb\nc\td\ne');
    assert.equal(normalizeAttachedFileText('x​\ty'), 'x\ty');
  });

  it('measures a file as the UTF-8 JSON that travels', () => {
    assert.equal(attachedFileBytes({ name: 'a', text: 'é' }), new TextEncoder().encode('{"name":"a","text":"é"}').length);
  });

  it('lists up to three names, then how many more', () => {
    assert.equal(quotedNameList(['a.txt']), '“a.txt”');
    assert.equal(quotedNameList(['a', 'b', 'c', 'd', 'e']), '“a”, “b”, “c” and 2 more');
  });

  it('says what the board takes', () => {
    assert.match(unsupportedDropMessage(true), /text files/);
    assert.doesNotMatch(unsupportedDropMessage(false), /text/);
  });

  it('knows file names pasted beside files', () => {
    const files = [{ name: 'notes.md' }, { name: 'data.csv' }];
    assert.equal(clipboardTextIsFileNames(files, 'notes.md\ndata.csv'), true);
    assert.equal(clipboardTextIsFileNames(files, '/Users/me/notes.md'), true);
    assert.equal(clipboardTextIsFileNames(files, 'Summarize these'), false);
    assert.equal(clipboardTextIsFileNames(files, ''), false);
  });
});

describe('telling text from binary', () => {
  it('reads UTF-8 and UTF-16 with a byte-order mark', () => {
    assert.equal(decodeTextFileBytes(new TextEncoder().encode('naïve, café')), 'naïve, café');
    const utf16 = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    assert.equal(decodeTextFileBytes(utf16), 'hi');
  });

  it('falls back to Windows-1252 for Latin-1 text', () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    assert.equal(looksLikeLatin1Text(latin1), true);
    assert.equal(decodeTextFileBytes(latin1), 'café');
  });

  it('refuses control characters and broken UTF-8 runs', () => {
    assert.equal(decodeTextFileBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), undefined);
    assert.equal(decodeTextFileBytes(new Uint8Array([0x61, 0x00, 0x62])), undefined);
    assert.equal(looksLikeLatin1Text(new Uint8Array([0xc3, 0xa9, 0xff])), false);
    assert.equal(looksLikeLatin1Text(new Uint8Array([0xe9, 0xe9, 0xe9])), false);
  });

  it('accepts a cut character at the end of a sniffed start', () => {
    const bytes = new TextEncoder().encode('abc é');
    assert.equal(decodeTextFileBytes(bytes.slice(0, bytes.length - 1), false), 'abc ');
  });
});

describe('attaching files', () => {
  it('attaches text files with their normalized text', async () => {
    const result = await attachFiles([textFile('notes.md', '# Plan\r\n- ship')]);
    assert.deepEqual(result, { took: ['notes.md'], said: [] });
    assert.deepEqual(attachedFilesContext(useAttachedFiles.getState().files), [{ name: 'notes.md', text: '# Plan\n- ship' }]);
  });

  it('names a file without one, and replaces a file of the same name', async () => {
    await attachFiles([textFile('', 'first')]);
    assert.deepEqual(names(), ['Untitled 1']);
    await attachFiles([textFile('a.txt', 'one'), textFile('a.txt', 'two')]);
    assert.deepEqual(names(), ['Untitled 1', 'a.txt']);
    assert.equal(useAttachedFiles.getState().files.at(-1)?.text, 'two');
  });

  it('refuses binary, empty and oversized files, saying why', async () => {
    const binary = new File([new Uint8Array([0, 1, 2, 3])], 'photo.heic');
    const result = await attachFiles([binary, textFile('blank.txt', ''), textFile('big.csv', 'x'.repeat(ATTACHED_FILE_READ_MAX + 10))]);
    assert.deepEqual(result.took, []);
    assert.equal(result.said[0], unsupportedDropMessage(true));
    assert.equal(result.said[1], 'Couldn’t attach “blank.txt”. It’s empty.');
    assert.match(result.said[2] ?? '', /^Couldn’t attach “big\.csv”\. Files on one request are limited to 40 KB/);
  });

  it('keeps all files of a request within the budget', async () => {
    const half = 'y'.repeat(ATTACHED_FILES_MAX_BYTES / 2);
    const result = await attachFiles([textFile('one.txt', half), textFile('two.txt', half)]);
    assert.deepEqual(result.took, ['one.txt']);
    assert.match(result.said[0] ?? '', /“two\.txt”/);
    dropAttachedFile(useAttachedFiles.getState().files[0]!.n);
    assert.deepEqual((await attachFiles([textFile('two.txt', half)])).took, ['two.txt']);
  });

  it('asks again for files still being read when a request went', async () => {
    const reading = attachFiles([textFile('late.txt', 'hello')]);
    takeAttachedFiles();
    const result = await reading;
    assert.deepEqual(result.took, []);
    assert.deepEqual(result.said, ['Couldn’t attach “late.txt”. The request had already gone. Attach again.']);
  });
});

describe('sending', () => {
  it('takes the files for a request and gives them back when it fails', async () => {
    await attachFiles([textFile('a.txt', 'alpha'), textFile('b.txt', 'beta')]);
    const taken = takeAttachedFiles();
    assert.deepEqual(
      taken.map((file) => file.name),
      ['a.txt', 'b.txt'],
    );
    assert.deepEqual(names(), []);
    // A newer file of the same name wins over one given back.
    await attachFiles([textFile('b.txt', 'newer')]);
    assert.deepEqual(giveBackAttachedFiles(taken), []);
    assert.deepEqual(names(), ['b.txt', 'a.txt']);
    assert.equal(useAttachedFiles.getState().files[0]?.text, 'newer');
  });

  it('says which files given back no longer fit', async () => {
    const big = 'z'.repeat(ATTACHED_FILES_MAX_BYTES - 200);
    await attachFiles([textFile('old.txt', big)]);
    const taken = takeAttachedFiles();
    await attachFiles([textFile('new.txt', big)]);
    const said = giveBackAttachedFiles(taken);
    assert.deepEqual(names(), ['new.txt']);
    assert.match(said[0] ?? '', /^No longer attached: “old\.txt”\./);
  });
});

describe('offering a drop to the Ask panel', () => {
  it('leaves pictures and videos to the board', async () => {
    const host = fakeHost(true);
    await offerTextFiles([new File(['x'], 'cat.png', { type: 'image/png' })], host);
    assert.deepEqual([host.toasts, host.spoken, host.opened], [[], [], 0]);
  });

  it('says what the board takes when this viewer cannot ask', async () => {
    const host = fakeHost(false);
    await offerTextFiles([textFile('notes.txt', 'hi')], host);
    assert.deepEqual(host.toasts, [unsupportedDropMessage(false)]);
    assert.deepEqual(names(), []);
  });

  it('attaches text files, says so and opens the panel', async () => {
    const host = fakeHost(true);
    await offerTextFiles([textFile('notes.txt', 'hi'), new File(['x'], 'cat.png', { type: 'image/png' })], host);
    assert.deepEqual(names(), ['notes.txt']);
    assert.deepEqual(host.spoken, ['Attached “notes.txt”.']);
    assert.equal(host.opened, 1);
  });

  it('keeps an open panel open and reports files it could not attach', async () => {
    const host = fakeHost(true, true);
    await offerTextFiles([textFile('empty.txt', '')], host);
    assert.deepEqual(host.toasts, ['Couldn’t attach “empty.txt”. It’s empty.']);
    assert.equal(host.opened, 0);
  });
});
