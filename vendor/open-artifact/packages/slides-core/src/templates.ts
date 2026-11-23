/**
 * Starter layouts for new slides, and the neutral text styles.
 *
 * Layouts are written in the slide format itself and compiled, so a new
 * slide is exactly what an agent would have written by hand and round-trips
 * through the serializer unchanged.
 */

import { compileSlide } from './compile.ts';
import type { Slide, StyleMap } from './model.ts';

/** Ids of the starter layouts, in picker order. */
export const LAYOUT_IDS = ['blank', 'title', 'section', 'title-body', 'bullets', 'two-col', 'table', 'quote', 'image-caption', 'closing'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

/** Picker names of the layouts. */
export const LAYOUT_NAMES: Record<LayoutId, string> = {
  blank: 'Blank',
  title: 'Title',
  section: 'Section',
  'title-body': 'Title + body',
  bullets: 'Bullets',
  'two-col': 'Two columns',
  table: 'Table',
  quote: 'Quote',
  'image-caption': 'Image + caption',
  closing: 'Closing',
};

/** The text style presets of the Text style menu. */
export const TEXT_STYLE_IDS = ['display', 'h1', 'h2', 'h3', 'lead', 'eyebrow', 'body', 'caption'] as const;
export type TextStyleId = (typeof TEXT_STYLE_IDS)[number];

/** Menu names of the text styles. */
export const TEXT_STYLE_NAMES: Record<TextStyleId, string> = {
  display: 'Display',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  lead: 'Lead',
  eyebrow: 'Eyebrow',
  body: 'Body',
  caption: 'Caption',
};

/** One text style: the tag it writes and its type settings. */
export interface TextStyle {
  tag: 'h1' | 'h2' | 'h3' | 'p';
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  /** Eyebrows are spaced capitals. */
  uppercase?: boolean;
  letterSpacing?: number;
}

/** The neutral type scale. */
export const TEXT_STYLES: Record<TextStyleId, TextStyle> = {
  display: { tag: 'h1', fontSize: 128, fontWeight: 600, lineHeight: 1.05 },
  h1: { tag: 'h1', fontSize: 96, fontWeight: 600, lineHeight: 1.1 },
  h2: { tag: 'h2', fontSize: 64, fontWeight: 600, lineHeight: 1.15 },
  h3: { tag: 'h3', fontSize: 44, fontWeight: 600, lineHeight: 1.2 },
  lead: { tag: 'p', fontSize: 40, fontWeight: 400, lineHeight: 1.35 },
  eyebrow: { tag: 'p', fontSize: 24, fontWeight: 600, lineHeight: 1.2, uppercase: true, letterSpacing: 2 },
  body: { tag: 'p', fontSize: 32, fontWeight: 400, lineHeight: 1.4 },
  caption: { tag: 'p', fontSize: 24, fontWeight: 400, lineHeight: 1.4 },
};

/** The tag defaults each text tag already carries (so a style only writes what differs). */
const TAG_DEFAULTS: Record<TextStyle['tag'], { fontSize: number; fontWeight: number; lineHeight: number }> = {
  h1: { fontSize: 96, fontWeight: 600, lineHeight: 1.1 },
  h2: { fontSize: 64, fontWeight: 600, lineHeight: 1.15 },
  h3: { fontSize: 44, fontWeight: 600, lineHeight: 1.2 },
  p: { fontSize: 32, fontWeight: 400, lineHeight: 1.4 },
};

/** The declarations a text style sets on its tag (only those differing from the tag defaults). */
export function textStyleDeclarations(id: TextStyleId): StyleMap {
  const style = TEXT_STYLES[id];
  const base = TAG_DEFAULTS[style.tag];
  const out: StyleMap = {};
  if (style.fontSize !== base.fontSize) out['font-size'] = `${style.fontSize}px`;
  if (style.fontWeight !== base.fontWeight) out['font-weight'] = String(style.fontWeight);
  if (style.lineHeight !== base.lineHeight) out['line-height'] = String(style.lineHeight);
  if (style.uppercase) out['text-transform'] = 'uppercase';
  if (style.letterSpacing) out['letter-spacing'] = `${style.letterSpacing}px`;
  return out;
}

/** The text style a text element matches, if any. */
export function matchTextStyle(tag: string, style: StyleMap): TextStyleId | undefined {
  for (const id of TEXT_STYLE_IDS) {
    const preset = TEXT_STYLES[id];
    if (preset.tag !== tag) continue;
    const want = textStyleDeclarations(id);
    const keys = ['font-size', 'font-weight', 'line-height', 'text-transform', 'letter-spacing'] as const;
    if (keys.every((key) => (style[key] ?? undefined) === want[key])) return id;
  }
  return undefined;
}

/** The section style every layout starts from. */
const SECTION = 'background:#ffffff;color:#1a1a1a;padding:128px;display:flex;flex-direction:column;gap:48px';
const MUTED = '#5c5c5c';
const FAINT = '#8a8a8a';

function css(style: StyleMap): string {
  return Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

/** The source of a layout, with the slide id filled in. */
export function layoutHtml(layout: LayoutId, id: string): string {
  const display = css(textStyleDeclarations('display'));
  const lead = css(textStyleDeclarations('lead'));
  const eyebrow = css(textStyleDeclarations('eyebrow'));
  const caption = css(textStyleDeclarations('caption'));
  const body = (): string => {
    switch (layout) {
      case 'blank':
        return '';
      case 'title':
        return [
          `<h1 style="${display};max-width:1500px">Presentation title</h1>`,
          `<p style="${lead};color:${MUTED};max-width:1500px">A one-line subtitle for the presentation.</p>`,
        ].join('\n');
      case 'section':
        return [`<p style="${eyebrow};color:${FAINT}">Section 01</p>`, '<h1 style="max-width:1500px">Section title</h1>'].join('\n');
      case 'title-body':
        return ['<h2>Heading</h2>', '<p style="max-width:1200px">Body copy goes here. Double-click any text to edit it in place.</p>'].join('\n');
      case 'bullets':
        return ['<h2>Key points</h2>', `<ul style="${lead};max-width:1400px">`, '<li>First point</li>', '<li>Second point</li>', '<li>Third point</li>', '</ul>'].join('\n');
      case 'two-col':
        return [
          '<h2>Compare</h2>',
          '<div style="display:flex;flex-direction:row;gap:144px">',
          '<div style="flex:1;gap:24px"><h3>Left</h3><p>Left column copy.</p></div>',
          '<div style="flex:1;gap:24px"><h3>Right</h3><p>Right column copy.</p></div>',
          '</div>',
        ].join('\n');
      case 'table':
        return [
          '<h2>Summary</h2>',
          '<table>',
          '<tr><th>Item</th><th>Status</th><th>Owner</th></tr>',
          '<tr><td></td><td></td><td></td></tr>',
          '<tr><td></td><td></td><td></td></tr>',
          '<tr><td></td><td></td><td></td></tr>',
          '</table>',
        ].join('\n');
      case 'quote':
        return [
          '<h2 style="text-align:center;max-width:1500px">“A memorable line worth a whole slide.”</h2>',
          `<p style="${caption};text-align:center;color:${MUTED}">— Attribution</p>`,
        ].join('\n');
      case 'image-caption':
        return [
          '<img alt="" style="width:1100px;height:700px;border-radius:16px;object-fit:cover">',
          `<p style="${caption};text-align:center;color:${FAINT};width:1100px">Caption for the image.</p>`,
        ].join('\n');
      case 'closing':
        return `<h1 style="${display}">Thank you</h1>`;
    }
  };
  const align =
    layout === 'title' || layout === 'section' || layout === 'closing'
      ? ';justify-content:center'
      : layout === 'quote' || layout === 'image-caption'
        ? ';justify-content:center;align-items:center'
        : '';
  return `<section id="${id}" style="${SECTION}${align}">\n${body()}\n</section>\n`;
}

/** A new slide of a layout. */
export function makeLayout(layout: LayoutId, id: string): Slide {
  return compileSlide(layoutHtml(layout, id), { id, lints: false }).slide;
}

/** The text a new text box starts with. */
export const DEFAULT_TEXT = 'Text';
/** The header label of a new table column. */
export const DEFAULT_COLUMN_LABEL = 'Column';
