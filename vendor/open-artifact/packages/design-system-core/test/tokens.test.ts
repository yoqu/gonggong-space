import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assetKey,
  buildManifest,
  checkDesignSystem,
  compileTokensCss,
  emptySystemIndex,
  listComponents,
  normalizeTokens,
  parseCardMarker,
} from '../src/index.ts';

const TOKENS = {
  name: 'Acme',
  color: {
    themes: [{ id: 'Light', name: 'Light' }, { id: 'dark', name: 'Dark' }],
    tokens: [
      { name: 'surface-100', value: { light: '#FBF7F1', dark: '#1d1a17' }, usage: 'Page background.' },
      { name: 'ink', value: { light: '#2b2118', dark: 'oklch(0.9 0.02 80)' } },
      { name: 'accent', value: '{ink}' },
      { name: 'loop-a', value: '{loop-b}' },
      { name: 'loop-b', value: '{loop-a}' },
      { name: 'evil', value: 'red; } body { background: url(x)' },
      { name: 'late', value: { dark: '#000' } },
    ],
  },
  type: {
    fonts: [{ family: 'Acme Sans', file: 'AcmeSans.woff2', weight: '300 800' }],
    families: { Sans: '"Acme Sans", system-ui, sans-serif', bad: 'x; }' },
    groups: [{ name: 'Text', family: 'sans', styles: [{ name: 'body', fontSize: 15, lineHeight: 1.4, fontWeight: 'bold' }, { name: 'bad', fontSize: 'huge' }] }],
  },
  spacing: { tokens: [{ name: 'space-1.5', value: '6px' }, { name: 'ink', value: '4px' }] },
  radius: { tokens: [{ name: 'radius-md', value: 8 }] },
  shadow: { tokens: [{ name: 'shadow-sm', value: { light: '0 1px 2px rgba(0,0,0,0.1)', dark: '0 1px 2px #000' } }] },
  zIndex: { tokens: [{ name: 'z-modal', value: 100 }] },
  motion: { duration: '200ms' },
};

describe('tokens', () => {
  const { tokens, notes } = normalizeTokens(TOKENS);

  it('validates, lowercases and resolves', () => {
    assert.deepEqual(tokens.themes.map((t) => t.id), ['light', 'dark']);
    assert.deepEqual(tokens.colors.map((t) => t.name), ['surface-100', 'ink', 'accent', 'late']);
    assert.equal(tokens.colors[0]!.resolved.light, '#fbf7f1');
    assert.equal(tokens.colors[2]!.resolved.dark, 'oklch(0.9 0.02 80)');
    assert.equal(tokens.colors[3]!.resolved.light, '#000', 'a later-theme-only value is borrowed for the first');
    assert.deepEqual(tokens.spacing.map((t) => t.name), ['space-1.5'], 'duplicate --ink dropped');
    assert.equal(tokens.radius[0]!.value, '8px');
    assert.deepEqual(Object.keys(tokens.families), ['sans']);
    assert.equal(tokens.groups[0]!.styles.length, 1);
    assert.equal(tokens.groups[0]!.styles[0]!.fontWeight, '700');
    assert.equal(tokens.fonts[0]!.file, 'fonts/AcmeSans.woff2');
    assert.equal(tokens.extras[0]!.title, 'Z index');
    assert.ok(notes.some((n) => n.message.includes('loop-a')));
    assert.ok(notes.some((n) => n.message.includes('evil')));
    assert.ok(notes.some((n) => n.message.includes('"motion"')));
  });

  it('compiles tokens.css', () => {
    const css = compileTokensCss(tokens, { title: 'Acme' });
    assert.match(css, /^\/\* Acme — generated from tokens\.json \*\//);
    assert.match(css, /:root, \[data-theme="light"\] \{\n  --surface-100: #fbf7f1;/);
    assert.match(css, /--accent: var\(--ink\);/);
    assert.match(css, /\[data-theme="dark"\] \{\n  --surface-100: #1d1a17;\n  --ink: oklch\(0\.9 0\.02 80\);\n  --accent: var\(--ink\);/);
    assert.match(css, /--space-1\\\.5: 6px;/);
    assert.match(css, /--font-sans: "Acme Sans", system-ui, sans-serif;/);
    assert.match(css, /--text-body: 700 15px\/1\.4 var\(--font-sans\);/);
    assert.match(css, /\.body \{\s+font-family: var\(--font-sans\);\s+font-size: 15px;\s+line-height: 1\.4;\s+font-weight: 700;\s+letter-spacing: 0;/);
    assert.match(css, /@font-face \{ font-family: "Acme Sans"; src: url\("fonts\/AcmeSans\.woff2"\) format\("woff2"\); font-weight: 300 800;/);
    assert.doesNotMatch(css, /url\(x\)|body \{ background/);
  });
});

describe('system', () => {
  const files = new Map<string, string>([
    ['design-system.json', JSON.stringify(emptySystemIndex('Acme UI', new Date('2026-01-01T00:00:00Z')))],
    ['tokens.json', JSON.stringify(TOKENS)],
    ['README.md', '# Acme\n\nHello.'],
    ['components/bundle.js', '/* @ds-bundle: {"format":4,"namespace":"AcmeUI","components":[{"name":"Button"}]} */\nwindow.AcmeUI = {};'],
    ['components/Button/preview.html', '<!-- @dsCard group="Actions" height=88 subtitle="Primary" -->\n<div id="root"></div>'],
    ['components/Button/README.md', '# Button\n\nTriggers an action. Use one per view.'],
    ['components/Badge/preview.html', '<div></div>'],
  ]);

  it('parses markers and lists components', () => {
    assert.deepEqual(parseCardMarker('<!-- @dsCard group="Actions" height=88 subtitle="Primary" -->'), { group: 'Actions', height: 88, subtitle: 'Primary' });
    const components = listComponents(files);
    assert.deepEqual(components.map((c) => c.name), ['Button', 'Badge']);
    assert.equal(components[0]!.summary, 'Triggers an action.');
  });

  it('builds the manifest', () => {
    const manifest = buildManifest(JSON.parse(files.get('design-system.json')!), files);
    assert.equal(manifest.manifestVersion, 3);
    assert.equal(manifest.namespace, 'AcmeUI');
    assert.deepEqual(manifest.files, ['components/Button/README.md', 'components/bundle.js', 'tokens.css']);
    assert.deepEqual(manifest.components[0], { name: 'Button', group: 'Actions', summary: 'Triggers an action.' });
  });

  it('encodes asset keys', () => {
    assert.equal(assetKey('acme mark é.svg'), 'acme~20mark~20~c3~a9.svg');
  });

  it('checks the project', () => {
    const findings = checkDesignSystem(files);
    assert.ok(findings.some((f) => f.level === 'error' && f.message.includes('loop-a')));
    assert.ok(findings.filter((f) => f.level === 'error').every((f) => f.file === 'tokens.json'));
    assert.ok(findings.some((f) => f.file === 'components/Badge/preview.html' && f.message.includes('marker')));
  });
});

describe('generateSystemFiles', () => {
  it('writes every generated file and drops cards of removed components', async () => {
    const { emptySystemIndex, generateSystemFiles, USAGE_START } = await import('../src/index.ts');
    const files = new Map<string, string>([
      ['design-system.json', JSON.stringify({ ...emptySystemIndex('Acme UI'), namespace: 'Acme' })],
      ['tokens.json', JSON.stringify({ color: { themes: [{ id: 'light', name: 'Light' }], tokens: [{ name: 'accent', value: '#c2410c' }] } })],
      ['README.md', '# Acme UI\n\nRules.\n'],
      ['components/bundle.js', '/* @ds-bundle: {"format":1,"namespace":"Acme","components":[{"name":"Button"}]} */\nwindow.Acme = {};\n'],
      ['components/Button/preview.html', '<!-- @dsCard height=120 group="Actions" -->\n<div></div>\n'],
      ['api/components/Gone.md', 'stale'],
    ]);
    const out = generateSystemFiles({ files });
    assert.match(out['tokens.css'] ?? '', /--accent: #c2410c;/);
    assert.equal(JSON.parse(out['manifest.json'] ?? '{}').namespace, 'Acme');
    assert.equal(out['api/components/Gone.md'], null);
    assert.ok(Object.keys(out).some((path) => path.startsWith('api/components/Button')));
    assert.ok((out['README.md'] ?? '').startsWith('# Acme UI\n\nRules.'));
    assert.ok((out['README.md'] ?? '').includes(USAGE_START));
  });

  it('generates nothing without a readable index', async () => {
    const { generateSystemFiles } = await import('../src/index.ts');
    assert.deepEqual(generateSystemFiles({ files: new Map([['design-system.json', '{']]) }), {});
  });
});

describe('published design systems', () => {
  it('edits a legacy palette without losing its other tokens or theme overrides', async () => {
    const { setThemedValue, renameEntry } = await import('../src/index.ts');
    const raw = {
      color: { themes: ['Light', 'dark'], groups: [{ tokens: [{ name: 'ink', value: '#111' }, { name: 'text', value: '{--ink}' }] }] },
      radius: { tokens: [{ name: 'pill', value: 'full' }] },
      motion: { tokens: [{ name: 'fast', value: 125 }] },
    };
    const edited = renameEntry(setThemedValue(raw, 'color', 'ink', '#fff', 'dark'), 'color', 'ink', 'fg');
    const { tokens } = normalizeTokens(edited);
    assert.deepEqual(tokens.colors.map((c) => c.name), ['fg', 'text']);
    assert.deepEqual(tokens.colors[1]?.resolved, { light: '#111', dark: '#fff' });
    assert.equal(tokens.radius[0]?.value, '9999px');
    assert.equal(tokens.extras[0]?.tokens[0]?.value, '125ms');
  });

  it('combines encoded groups, physical files and uploads into one catalogue', async () => {
    const { normalizeSystemIndex, listAssets, generateSystemFiles } = await import('../src/index.ts');
    const name = '品牌 Logos';
    const key = assetKey(name);
    const record = (name: string) => ({ name, blob: '0123456789abcdef0123456789abcdef', size: 8, type: 'image/svg+xml' });
    const index = normalizeSystemIndex({ ...emptySystemIndex('Acme'), groups: [key], assetGroups: {
      [key]: { order: ['logo.svg', 'alt.svg'], files: { 'logo.svg': record('logo.svg'), 'alt.svg': record('alt.svg') } },
    } });
    const files = new Map([['design-system.json', JSON.stringify(index)], [`assets/${name}/logo.svg`, '<svg/>'], ['components/index.d.ts', 'export type IconName = "close" | "menu";']]);
    const groups = listAssets(index, files.keys());
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.name, name);
    assert.deepEqual(groups[0]?.items.map((item) => item.path ?? item.blob), [`assets/${name}/logo.svg`, record('').blob]);
    const generated = generateSystemFiles({ files });
    assert.match(generated['api/assets/Logos.md']!, /logo\.svg/);
    assert.match(generated['api/icons.md']!, /menu/);
    assert.deepEqual(JSON.parse(generated['manifest.json']!).assetGroups[0].files, [{ path: `assets/${name}/alt.svg`, id: record('').blob }]);
  });

  it('rejects unreadable token maps even when the document is valid JSON', () => {
    const files = new Map([['design-system.json', JSON.stringify(emptySystemIndex('Acme'))], ['tokens.json', '{"color":{"accent":{"$value":"#123"}}}']]);
    assert.ok(checkDesignSystem(files).some((f) => f.file === 'tokens.json' && f.level === 'error'));
  });
});
