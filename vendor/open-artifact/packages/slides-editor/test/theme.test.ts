import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTokens } from '@open-artifact/design-system-core';
import { compileSlide, newDeckIndex, type Slide } from '@open-artifact/slides-core';
import { contrast, statusBand } from '../src/services/theme/color.ts';
import { analyzeDeck, deckFamilies } from '../src/services/theme/analysis.ts';
import {
  carryFaces,
  identifyUse,
  memorySlots,
  nextMemory,
  originalEntry,
  planColors,
  readThemeMemory,
  restyleSlideColors,
  restyleSlideFamilies,
  strayUses,
  withThemeMemory,
  type LookEntry,
} from '../src/services/theme/restyle.ts';
import { analyzeSystem, assignThemeRoles, namedRole } from '../src/services/theme/system.ts';
import { mapValueColors, slideColorUses } from '../src/services/theme/walk.ts';

const slide = (html: string, id = 's1'): Slide => {
  const result = compileSlide(html.replace('<section', `<section id="${id}"`), { id });
  assert.deepEqual(result.diagnostics.filter((d) => d.level === 'error'), []);
  return result.slide;
};

const DECK = [
  slide(
    `<section style="background:#ffffff;color:#111111;font-family:Georgia, serif"><h1 style="font-family:Arial, sans-serif">Title</h1>` +
      `<div style="background:#2563eb;padding:24px"><p style="color:#ffffff">On accent</p></div>` +
      `<p style="color:#6b7280;border-bottom:2px solid #e5e7eb">Muted</p><p style="color:#2563eb">Link</p></section>`,
    's1',
  ),
  slide(`<section style="background:#ffffff;color:#111111"><h2 style="font-family:Arial, sans-serif">Second</h2><p>Body</p></section>`, 's2'),
];

const BRAND = normalizeTokens({
  name: 'Night',
  color: {
    themes: [
      { id: 'dark', name: 'Dark' },
      { id: 'light', name: 'Light' },
    ],
    tokens: [
      { name: 'bg', value: { dark: '#0b1020', light: '#fafafa' } },
      { name: 'surface-raised', value: { dark: '#161c30', light: '#f0f0f0' } },
      { name: 'text', value: { dark: '#f5f5f5', light: '#121212' } },
      { name: 'text-muted', value: { dark: '#9aa3b5', light: '#5f6670' } },
      { name: 'border', value: { dark: '#2a3247', light: '#dddddd' } },
      { name: 'primary', value: { dark: '#ff7a59', light: '#d9480f' } },
      { name: 'on-primary', value: { dark: '#1a0b05', light: '#ffffff' } },
      { name: 'danger', value: '#e5484d' },
    ],
  },
  type: {
    families: { display: '"Playfair Display", serif', body: '"Inter", sans-serif' },
    fonts: [],
    groups: [
      { name: 'Headings', family: 'display', styles: [{ name: 'Display', fontSize: 64 }] },
      { name: 'Text', family: 'body', styles: [{ name: 'Body', fontSize: 24 }] },
    ],
  },
}).tokens;

describe('theme: colour helpers', () => {
  it('rewrites colours outside url()', () => {
    const seen: string[] = [];
    const out = mapValueColors('linear-gradient(90deg, #ff0000 0%, rgba(0, 0, 255, 0.5) 100%), url(/_blob/abc#fff)', (hex) => {
      seen.push(hex);
      return hex === '#ff0000' ? '#00ff00' : undefined;
    });
    assert.deepEqual(seen, ['#ff0000', '#0000ff']);
    assert.equal(out, 'linear-gradient(90deg, #00ff00 0%, rgba(0, 0, 255, 0.5) 100%), url(/_blob/abc#fff)');
  });

  it('reads status hue bands', () => {
    assert.equal(statusBand('#16a34a'), 'success');
    assert.equal(statusBand('#dc2626'), 'danger');
    assert.equal(statusBand('#f59e0b'), 'warning');
    assert.equal(statusBand('#6b7280'), null);
  });
});

describe('theme: design systems', () => {
  it('names roles from token names', () => {
    assert.equal(namedRole('brandPrimary'), 'accent');
    assert.equal(namedRole('primary-foreground'), 'on-accent');
    assert.equal(namedRole('text-secondary'), 'muted');
    assert.equal(namedRole('surface-raised'), 'surface');
    assert.equal(namedRole('color.bg.canvas'), 'background');
    assert.equal(namedRole('border-subtle'), 'border');
    assert.equal(namedRole('error'), 'danger');
  });

  it('gives unnamed tokens roles by contrast against the background', () => {
    const { colors, dark } = assignThemeRoles([
      { name: 'paper', value: '#ffffff' },
      { name: 'n900', value: '#111111' },
      { name: 'n500', value: '#777777' },
      { name: 'n100', value: '#f3f3f3' },
      { name: 'blue', value: '#2563eb' },
    ]);
    assert.equal(dark, false);
    const role = (name: string): string | undefined => colors.find((c) => c.name === name)?.role;
    assert.equal(role('paper'), 'background');
    assert.equal(role('n900'), 'text');
    assert.equal(role('n500'), 'muted');
    assert.equal(role('n100'), 'surface');
    assert.equal(role('blue'), 'accent');
  });

  it('analyses themes and typefaces', () => {
    const system = analyzeSystem('night', 'Night', BRAND);
    assert.deepEqual(system.themes.map((t) => [t.id, t.dark]), [['dark', true], ['light', false]]);
    assert.equal(system.heading?.family, 'Playfair Display');
    assert.equal(system.body?.family, 'Inter');
  });
});

describe('theme: deck analysis', () => {
  const analysis = analyzeDeck(DECK);
  const slot = (id: string): string | undefined => analysis.slots.find((s) => s.id === id)?.value;

  it('maps the deck colours to roles', () => {
    assert.equal(analysis.ground, '#ffffff');
    assert.equal(slot('background'), '#ffffff');
    assert.equal(slot('text'), '#111111');
    assert.equal(slot('accent'), '#2563eb');
    assert.equal(slot('on-accent'), '#ffffff');
    assert.equal(slot('muted'), '#6b7280');
    assert.ok(analysis.slots.some((s) => s.role === 'border' && s.value === '#e5e7eb'));
    assert.equal(analysis.over, false);
  });

  it('records what inks sit on', () => {
    assert.equal(analysis.slots.find((s) => s.id === 'on-accent')?.on, 'accent');
    assert.equal(analysis.slots.find((s) => s.id === 'text')?.on, 'background');
  });

  it('reads heading and body typefaces', () => {
    assert.deepEqual(deckFamilies(DECK), { heading: 'arial', body: 'georgia' });
  });
});

describe('theme: restyle', () => {
  const analysis = analyzeDeck(DECK);
  const dark = analyzeSystem('night', 'Night', BRAND).themes[0]!;
  const to = planColors(analysis.slots, dark);

  it('plans each slot from the theme colour of its role, legibly', () => {
    assert.equal(to.background, '#0b1020');
    assert.equal(to.text, '#f5f5f5');
    assert.equal(to.accent, '#ff7a59');
    assert.equal(to['on-accent'], '#1a0b05');
    assert.ok(contrast(to.muted!, to.background!) >= 3);
    for (const s of analysis.slots) assert.ok(to[s.id], s.id);
  });

  it('rewrites every colour of a slide, keeping alpha', () => {
    const translucent = slide(`<section style="background:#ffffff"><div style="background:rgba(37, 99, 235, 0.5);padding:8px"></div></section>`);
    const plan = analyzeDeck([translucent]);
    const out = restyleSlideColors(translucent, { assign: plan.assign, from: [], to: { ...planColors(plan.slots, dark) } });
    assert.equal(out.style.background, '#0b1020');
    assert.match((out.children[0]!.style.background ?? ''), /^rgba\(255, 122, 89, 0\.5\)$/);
  });

  it('restyles the deck and back to the original exactly', () => {
    const original = originalEntry(analysis.slots);
    const restyled = DECK.map((s) => restyleSlideColors(s, { assign: analysis.assign, from: [original], to }));
    assert.equal(restyled[0]!.style.background, '#0b1020');
    const applied: LookEntry = { look: 'night/dark', colors: to };
    const back = restyled.map((s) => restyleSlideColors(s, { from: [applied, original], to: original.colors, on: original.on }));
    assert.deepEqual(back, DECK);
  });

  it('identifies equal colours by the ground they sit on', () => {
    const original = originalEntry(analysis.slots);
    // White is both the background and the text on the accent.
    assert.equal(identifyUse({ prop: 'ground', value: '#ffffff', on: '#ffffff' }, [original], original.on)?.slot, 'background');
    assert.equal(identifyUse({ prop: 'text', value: '#ffffff', on: '#2563eb' }, [original], original.on)?.slot, 'on-accent');
  });

  it('finds slides still wearing an earlier look', () => {
    const original = originalEntry(analysis.slots);
    const applied: LookEntry = { look: 'night/dark', colors: to };
    const restyled = restyleSlideColors(DECK[0]!, { assign: analysis.assign, from: [original], to });
    assert.equal(strayUses(restyled, [applied, original], original.on), 0);
    assert.ok(strayUses(DECK[1]!, [applied, original], original.on) > 0);
    const fixed = restyleSlideColors(DECK[1]!, { from: [applied, original], to: applied.colors, on: original.on });
    assert.equal(strayUses(fixed, [applied, original], original.on), 0);
    assert.equal(fixed.style.background, '#0b1020');
  });

  it('plans from remembered slots like from a fresh analysis', () => {
    const original = originalEntry(analysis.slots);
    assert.deepEqual(planColors(memorySlots(original), dark), to);
  });
});

describe('theme: typefaces', () => {
  it('changes headings and body independently', () => {
    const s = DECK[0]!;
    const body = restyleSlideFamilies(s, { body: { from: 'georgia', to: '"Inter", sans-serif' } });
    assert.equal(body.style['font-family'], '"Inter", sans-serif');
    assert.equal(body.children[0]!.style['font-family'], 'Arial, sans-serif');
    const heading = restyleSlideFamilies(s, { heading: { from: 'arial', to: '"Playfair Display", serif' } });
    assert.equal(heading.children[0]!.style['font-family'], '"Playfair Display", serif');
    assert.equal(heading.style['font-family'], 'Georgia, serif');
  });

  it('keeps an inheriting heading on its face when only the body changes', () => {
    const s = slide(`<section style="font-family:Georgia, serif"><h1>Title</h1><p>Body</p></section>`);
    const out = restyleSlideFamilies(s, { body: { from: 'georgia', to: 'Arial, sans-serif' } });
    assert.equal(out.style['font-family'], 'Arial, sans-serif');
    assert.equal(out.children[0]!.style['font-family'], 'Georgia, serif');
    assert.equal(out.children[1]!.style['font-family'], undefined);
  });

  it('carries new faces within the limit, dropping unused ones first', () => {
    const faces = { lora: { family: 'Lora', href: 'x' }, inter: { family: 'Inter', href: 'y' } };
    const out = carryFaces(faces, [['manrope', { family: 'Manrope', href: 'z' }]], new Set(['inter', 'manrope']), 2);
    assert.deepEqual(Object.keys(out ?? {}), ['inter', 'manrope']);
    assert.equal(carryFaces(faces, [['manrope', { family: 'Manrope', href: 'z' }]], new Set(['inter', 'lora', 'manrope']), 2), null);
  });
});

describe('theme: remembered looks', () => {
  const original: LookEntry = { look: '', colors: { background: '#ffffff' } };
  const a: LookEntry = { look: 'a/x', colors: { background: '#000000' } };
  const b: LookEntry = { look: 'b/y', colors: { background: '#111111' } };
  const c: LookEntry = { look: 'c/z', colors: { background: '#222222' } };

  it('keeps the last two looks, the current first, and the original always', () => {
    let memory = nextMemory(null, original, a);
    memory = nextMemory(memory, original, b);
    memory = nextMemory(memory, original, c);
    assert.deepEqual(memory.recent.map((e) => e.look), ['c/z', 'b/y']);
    assert.equal(memory.original, original);
    memory = nextMemory(memory, original, b);
    assert.deepEqual(memory.recent.map((e) => e.look), ['b/y', 'c/z']);
  });

  it('round-trips through deck.json style, keeping other style keys', () => {
    const index = { ...newDeckIndex('T'), style: { other: 1 } };
    const memory = nextMemory(null, original, a);
    const written = withThemeMemory(index, memory);
    assert.deepEqual((written.style as Record<string, unknown>).other, 1);
    assert.deepEqual(readThemeMemory(JSON.parse(JSON.stringify(written))), memory);
    assert.equal(readThemeMemory(newDeckIndex('T')), null);
  });

  it('every use of the sample deck is visited', () => {
    assert.ok(slideColorUses(DECK[0]!).length >= 6);
  });
});
