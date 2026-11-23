import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  BUILTIN_FONT_FILES,
  BUILTIN_FONT_FILES_DIR,
  BUILTIN_FONT_FILES_TOTAL_BYTES,
  BUILTIN_FONT_LICENCE_STEMS,
  BUILTIN_FONTS,
  builtinFontFileUrl,
  builtinFontLicence,
  builtinFontLicenceFileUrl,
  builtinFontLicenceOf,
  builtinFontLicenceRecord,
  confirmedFontAxis,
  fontLicenceNotices,
  fontLicenceProblem,
  googleFontLicenceRecord,
  gunzipBase64Text,
  hasVariationTable,
  isUsableWoff2,
  parseFontLicenceInventory,
  readFontLicenceNotices,
  woff2DataUri,
  type GunzipText,
} from '../src/fonts/index.ts';
import { FONT_LICENCE_INVENTORY_FAMILIES, FONT_LICENCE_INVENTORY_GZIP } from '../src/fonts/licence-inventory-data.ts';

const gunzipWithZlib: GunzipText = async (base64) => gunzipSync(Buffer.from(base64, 'base64')).toString('utf8');
const fontBytes = (file: string): Uint8Array => new Uint8Array(readFileSync(builtinFontFileUrl(file)));

describe('built-in font files', () => {
  it('lists every file of every built-in typeface with its size on disk', () => {
    const named = BUILTIN_FONTS.flatMap((font) => font.files.map((file) => file.file));
    assert.deepEqual([...BUILTIN_FONT_FILES.keys()].sort(), [...named].sort());
    assert.equal(BUILTIN_FONT_FILES.size, 23);
    for (const [file, info] of BUILTIN_FONT_FILES) {
      assert.equal(statSync(builtinFontFileUrl(file)).size, info.bytes, file);
      assert.ok(statSync(new URL(info.licence, BUILTIN_FONT_FILES_DIR)).isFile(), info.licence);
    }
    assert.equal(BUILTIN_FONT_FILES_TOTAL_BYTES, 508_472);
  });

  it('gives each file its typeface and licence', () => {
    assert.deepEqual(BUILTIN_FONT_FILES.get('FrauncesOpsz360-i.woff2'), {
      fontId: 'fraunces-display',
      family: 'Fraunces Display',
      weight: '1 1000',
      style: 'italic',
      bytes: 42_968,
      licence: 'Fraunces-OFL.txt',
    });
  });

  it('accepts every built-in file as a usable woff2', () => {
    for (const file of BUILTIN_FONT_FILES.keys()) assert.ok(isUsableWoff2(fontBytes(file)), file);
  });

  it('confirms a weight axis only for a file with a variation table', () => {
    const variable = fontBytes('InstrumentSansVar.woff2');
    const fixed = fontBytes('Manrope-500.woff2');
    assert.equal(hasVariationTable(variable), true);
    assert.equal(hasVariationTable(fixed), false);
    assert.equal(confirmedFontAxis('400 600', variable), '400 600');
    assert.equal(confirmedFontAxis('400 600', fixed), undefined);
  });

  it('rejects bytes that are not woff2', () => {
    assert.equal(isUsableWoff2(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0])), false);
    assert.equal(isUsableWoff2(fontBytes('DMMono-500.woff2').subarray(0, 40)), false);
  });

  it('writes a data URI that holds the bytes', () => {
    const bytes = fontBytes('DepartureMono-400.woff2');
    const uri = woff2DataUri(bytes);
    assert.ok(uri.startsWith('data:font/woff2;base64,'));
    assert.deepEqual(new Uint8Array(Buffer.from(uri.slice('data:font/woff2;base64,'.length), 'base64')), bytes);
  });
});

describe('built-in licences', () => {
  it('rebuilds each licence file’s text exactly', () => {
    for (const stem of BUILTIN_FONT_LICENCE_STEMS) assert.equal(builtinFontLicence(stem).licence, readFileSync(builtinFontLicenceFileUrl(stem), 'utf8'), stem);
  });

  it('finds a file’s licence by its name', () => {
    assert.equal(builtinFontLicenceOf('PlusJakartaSans-600.woff2')?.name, 'Plus Jakarta Sans');
    assert.equal(builtinFontLicenceOf('Unknown.woff2'), undefined);
  });

  it('writes an export’s licence record with its name and notice first', () => {
    const record = builtinFontLicenceRecord(builtinFontLicence('Manrope'));
    assert.equal(record.file, 'OFL.txt');
    assert.equal(record.from, 'built-in');
    assert.ok(record.text.startsWith('Manrope\n'));
    assert.ok(record.text.includes('Copyright 2019 The Manrope Project Authors'));
    assert.ok(record.text.endsWith('\n'));
  });
});

describe('the licence inventory', () => {
  it('decodes to every catalog family', async () => {
    const parsed = parseFontLicenceInventory(JSON.parse(await gunzipWithZlib(FONT_LICENCE_INVENTORY_GZIP)));
    assert.ok(parsed !== null);
    assert.equal(Object.keys(parsed.families).length, FONT_LICENCE_INVENTORY_FAMILIES);
    assert.equal(FONT_LICENCE_INVENTORY_FAMILIES, 1773);
    const notices = fontLicenceNotices(parsed, ['Inter', 'Not A Family']);
    assert.deepEqual([...notices.keys()], ['Inter']);
    const inter = notices.get('Inter')!;
    assert.equal(inter.licence, 'OFL-1.1');
    assert.ok(inter.notice.includes('SIL Open Font License'));
    assert.equal(fontLicenceProblem(inter), null);
    assert.equal(fontLicenceProblem(undefined), 'no-license-text');
    const record = googleFontLicenceRecord('Inter', inter);
    assert.equal(record.file, 'OFL.txt');
    assert.ok(record.text.startsWith('Inter\nThe page '));
  });

  it('decodes with the platform’s gzip stream', async () => {
    const notices = await readFontLicenceNotices(['Ubuntu'], gunzipBase64Text);
    assert.ok(notices !== null);
    assert.equal(fontLicenceProblem(notices.get('Ubuntu')), 'reserved-name');
  });

  it('refuses a malformed inventory', () => {
    assert.equal(parseFontLicenceInventory({ families: { A: [3, 'x'] }, texts: [] }), null);
    assert.equal(parseFontLicenceInventory({ families: {}, texts: [['MIT', 'x']] }), null);
    assert.equal(parseFontLicenceInventory([]), null);
  });
});
