#!/usr/bin/env node
/**
 * Builds `src/data/google-fonts.json`, the compact Google Fonts catalog the
 * font picker loads on demand.
 *
 * Usage:
 *   curl -sS https://fonts.google.com/metadata/fonts -o metadata.json
 *   node packages/ui/scripts/build-font-catalog.mjs metadata.json [families.json]
 *
 * `metadata.json` is Google Fonts' public family metadata (category, styles,
 * variable axes, popularity). `families.json`, when given, is a JSON array of
 * family names that limits the catalog (the reference list the artifact
 * types ship, which leaves out the very large CJK families).
 *
 * Output: { source, categories, families: [[family, category, weights,
 * italics, axes?], …] } sorted by popularity. `category` indexes
 * `categories`; `weights` and `italics` are digit strings, each digit d a
 * weight of d × 100 ("3457" is 300, 400, 500, 700; "a" is 1000); `axes` is
 * "tag:min:max,…".
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [metadataPath, familiesPath] = process.argv.slice(2);
if (!metadataPath) {
  console.error('usage: build-font-catalog.mjs <metadata.json> [families.json]');
  process.exit(1);
}

let text = readFileSync(metadataPath, 'utf8');
// The endpoint may prefix an XSSI guard line.
if (text.startsWith(")]}'")) text = text.slice(text.indexOf('\n') + 1);
const metadata = JSON.parse(text);
const allow = familiesPath ? new Set(JSON.parse(readFileSync(familiesPath, 'utf8'))) : null;

const CATEGORIES = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'];
const CATEGORY_OF = { 'Sans Serif': 0, Serif: 1, Display: 2, Handwriting: 3, Monospace: 4 };

// A few variable families also list an extreme instance (weight 1); their
// `wght` axis already carries the full range, so the digits keep 100…1000.
const digits = (weights) => {
  return [...new Set(weights.filter((w) => w % 100 === 0 && w >= 100 && w <= 1000))].sort((a, b) => a - b).map((w) => (w === 1000 ? 'a' : String(w / 100))).join('');
};

const rows = [];
for (const family of metadata.familyMetadataList) {
  if (allow && !allow.has(family.family)) continue;
  const category = CATEGORY_OF[family.category];
  if (category === undefined) throw new Error(`unknown category ${family.category} (${family.family})`);
  const styles = Object.keys(family.fonts);
  const weights = styles.filter((s) => /^\d+$/.test(s)).map(Number);
  const italics = styles.filter((s) => /^\d+i$/.test(s)).map((s) => Number(s.slice(0, -1)));
  const axes = (family.axes ?? []).map((axis) => `${axis.tag}:${+axis.min}:${+axis.max}`).join(',');
  const row = [family.family, category, digits(weights), digits(italics)];
  if (axes) row.push(axes);
  rows.push({ row, popularity: family.popularity ?? Number.MAX_SAFE_INTEGER });
}
rows.sort((a, b) => a.popularity - b.popularity || a.row[0].localeCompare(b.row[0]));

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/data/google-fonts.json');
const catalog = {
  source: 'fonts.google.com/metadata/fonts (public family metadata), sorted by popularity',
  categories: CATEGORIES,
  families: rows.map((r) => r.row),
};
// One family per line keeps diffs readable.
const body = catalog.families.map((row) => JSON.stringify(row)).join(',\n');
writeFileSync(out, `{"source":${JSON.stringify(catalog.source)},"categories":${JSON.stringify(CATEGORIES)},"families":[\n${body}\n]}\n`);
console.log(`${rows.length} families → ${out}`);
