import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTokens } from '@open-artifact/design-system-core';
import { matchSystemStyle, systemFromTokens, systemStyleDeclarations } from '../src/services/design-systems.ts';

const TOKENS = {
  name: 'Brand',
  color: {
    themes: [
      { id: 'light', name: 'Light' },
      { id: 'dark', name: 'Dark' },
    ],
    tokens: [
      { name: 'primary', value: { light: '#0055FF', dark: '#3377ff' }, usage: 'Buttons and links' },
      { name: 'ink', value: '#111111' },
      { name: 'link', value: '{primary}' },
    ],
  },
  type: {
    families: { sans: '"Inter", sans-serif' },
    fonts: [],
    groups: [
      {
        name: 'Headings',
        family: 'sans',
        styles: [
          { name: 'Display', fontSize: '4rem', lineHeight: 1.05, fontWeight: 700, letterSpacing: '-0.02em' },
          { name: 'Eyebrow', fontSize: 18, fontWeight: 600, textTransform: 'uppercase' },
        ],
      },
    ],
  },
};

describe('design systems', () => {
  const { tokens } = normalizeTokens(TOKENS);
  const system = systemFromTokens({ namespace: 'brand', title: 'Brand' }, tokens);

  it('offers the first theme of each color, once', () => {
    assert.deepEqual(
      system.colors.map((c) => [c.name, c.value]),
      [
        ['primary', '#0055ff'],
        ['ink', '#111111'],
      ],
    );
  });

  it('converts type styles to slide px', () => {
    const display = system.styles.find((s) => s.name === 'Display')!;
    assert.equal(display.tag, 'h1');
    assert.equal(display.declarations['font-size'], '64px');
    assert.equal(display.declarations['line-height'], '1.05');
    assert.equal(display.declarations['font-weight'], '700');
    assert.equal(display.declarations['letter-spacing'], '-1.28px');
    const eyebrow = system.styles.find((s) => s.name === 'Eyebrow')!;
    assert.equal(eyebrow.tag, 'p');
    assert.equal(eyebrow.declarations['text-transform'], 'uppercase');
  });

  it('keeps a font family only when the deck declares it', () => {
    const display = system.styles[0]!;
    assert.equal(systemStyleDeclarations(display, new Set(['inter']))['font-family'], 'Inter, sans-serif');
    assert.equal(systemStyleDeclarations(display, new Set())['font-family'], undefined);
  });

  it('matches a text element written with a style', () => {
    const display = system.styles[0]!;
    assert.equal(matchSystemStyle([system], 'h1', { ...display.declarations })?.id, display.id);
    assert.equal(matchSystemStyle([system], 'p', { ...display.declarations }), undefined);
  });
});
