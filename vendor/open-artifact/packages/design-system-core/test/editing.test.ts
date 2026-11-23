import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addEntry,
  buildApiCards,
  contrastPairs,
  contrastRatio,
  emptySystemIndex,
  familyEntries,
  normalizeTokens,
  parseHex,
  componentProps,
  readProps,
  removeEntry,
  renameEntry,
  setThemedValue,
  stripUsageBlock,
  updateStyle,
  withUsageBlock,
  USAGE_START,
} from '../src/index.ts';

const RAW = {
  meta: { source: 'github' },
  color: {
    themes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }],
    tokens: [
      { name: 'bg', value: { light: '#ffffff', dark: '#111111' }, usage: 'Page.' },
      { name: 'text', value: '#222222', extra: 1 },
      { name: 'link', value: '{text}' },
    ],
  },
  type: { fonts: [], families: { sans: 'system-ui' }, groups: [{ name: 'Body', family: 'sans', styles: [{ name: 'body', fontSize: 16 }] }] },
};

describe('raw token edits', () => {
  it('sets one theme of a single value and collapses an agreeing map', () => {
    const split = setThemedValue(RAW, 'color', 'text', '#eeeeee', 'dark');
    assert.deepEqual(familyEntries(split, 'color')[1]!.value, { light: '#222222', dark: '#eeeeee' });
    assert.equal(familyEntries(split, 'color')[1]!.extra, 1, 'unknown fields survive');
    const back = setThemedValue(split, 'color', 'text', '#222222', 'dark');
    assert.equal(familyEntries(back, 'color')[1]!.value, '#222222');
    assert.deepEqual((RAW.color.tokens[1] as { value: unknown }).value, '#222222', 'input not mutated');
  });

  it('renames a token and its aliases', () => {
    const next = renameEntry(RAW, 'color', 'text', 'ink');
    assert.deepEqual(familyEntries(next, 'color').map((e) => [e.name, e.value]), [
      ['bg', { light: '#ffffff', dark: '#111111' }],
      ['ink', '#222222'],
      ['link', '{ink}'],
    ]);
    assert.deepEqual(next.meta, { source: 'github' });
  });

  it('adds, removes and edits styles', () => {
    const added = addEntry({}, 'spacing', { name: 'space-1', value: '4px' });
    assert.deepEqual(added, { spacing: { tokens: [{ name: 'space-1', value: '4px' }] } });
    assert.equal(familyEntries(removeEntry(added, 'spacing', 'space-1'), 'spacing').length, 0);
    const styled = updateStyle(RAW, 'body', { fontSize: '17px', usage: undefined });
    const { tokens } = normalizeTokens(styled);
    assert.equal(tokens.groups[0]!.styles[0]!.fontSize, '17px');
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    assert.equal(Math.round(contrastRatio(parseHex('#000')!, parseHex('#fff')!)), 21);
    assert.ok(Math.abs(contrastRatio(parseHex('#777777')!, parseHex('#ffffff')!) - 4.48) < 0.01);
  });

  it('pairs text and on- tokens with backgrounds', () => {
    const pairs = contrastPairs(['bg', 'surface-1', 'text', 'text-muted', 'primary', 'on-primary', 'border']);
    assert.deepEqual(pairs[0], { foreground: 'on-primary', background: 'primary', large: false });
    assert.ok(pairs.some((p) => p.foreground === 'text-muted' && p.background === 'surface-1'));
    assert.ok(!pairs.some((p) => p.foreground === 'border'));
  });
});

describe('props', () => {
  it('reads a props interface with docs and defaults', () => {
    const dts = `import type { ReactNode } from 'react';
export interface ButtonProps {
  /** Visual weight. @default 'primary' */
  variant?:
    | 'primary'
    | 'secondary';
  /**
   * Label.
   */
  children: ReactNode;
  onClick?: (event: { x: number; y: number }) => void;
}
export declare function Button(props: ButtonProps): JSX.Element;`;
    const props = readProps(dts, 'Button');
    assert.deepEqual(props?.map((p) => [p.name, p.optional, p.doc ?? null]), [
      ['variant', true, 'Visual weight.'],
      ['children', false, 'Label.'],
      ['onClick', true, null],
    ]);
    assert.equal(props?.[0]!.defaultValue, "'primary'");
    assert.equal(props?.[2]!.type, '(event: { x: number; y: number }) => void');
  });

  it('falls back to the shared index.d.ts, matching only the named props', () => {
    const files = new Map([
      ['components/index.d.ts', 'export interface CardProps { title: string }\nexport interface ButtonProps { label: string; size?: "s" | "m" }'],
    ]);
    const read = (path: string): string | undefined => files.get(path);
    assert.deepEqual(componentProps(read, 'Button')?.props?.map((p) => p.name), ['label', 'size']);
    assert.equal(componentProps(read, 'Button')?.path, 'components/index.d.ts');
    assert.equal(componentProps(read, 'Badge'), null);
    files.set('components/Button/Button.d.ts', 'export interface ButtonProps { own: boolean }');
    assert.deepEqual(componentProps(read, 'Button')?.props?.map((p) => p.name), ['own']);
  });
});

describe('generated files', () => {
  it('keeps one usage block at the end of the README', () => {
    const once = withUsageBlock('# Acme\n\nRules.\n', 'Block one');
    const twice = withUsageBlock(once, 'Block two');
    assert.equal(twice.split(USAGE_START).length, 2);
    assert.ok(twice.includes('Block two') && !twice.includes('Block one'));
    assert.equal(stripUsageBlock(twice), '# Acme\n\nRules.\n');
  });

  it('writes token and component cards', () => {
    const files = new Map([
      ['components/bundle.js', '/* @ds-bundle: {"format":1,"namespace":"Acme","components":[{"name":"Button"}]} */\nwindow.Acme={};'],
      ['components/Button/README.md', '# Button\n\nThe main action.'],
      ['components/Button/Button.d.ts', 'export interface ButtonProps { /** Size. */ size?: "s" | "m"; }'],
    ]);
    const cards = buildApiCards({ index: emptySystemIndex('Acme'), tokens: normalizeTokens(RAW).tokens, files });
    assert.deepEqual(Object.keys(cards).sort(), ['api/README.md', 'api/components/Button.md', 'api/tokens.md']);
    assert.match(cards['api/components/Button.md']!, /window\.Acme/);
    assert.match(cards['api/components/Button.md']!, /\| `size\?` \| `"s" \\\| "m"` \|  \| Size\. \|/);
    assert.match(cards['api/tokens.md']!, /`--link`/);
  });
});
