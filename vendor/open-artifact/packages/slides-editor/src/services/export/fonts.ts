/**
 * The deck's typefaces as self-contained CSS for exports.
 *
 * Pictures of slides are drawn from serialized markup, which cannot load
 * fonts from the network, and an HTML export should open offline; so every
 * face is inlined as `@font-face` rules with `data:` URLs. Google Fonts
 * stylesheets are split by `unicode-range`; only the blocks covering
 * characters the deck uses are kept.
 */

import { blockUnicodeRange, cssUrls, fontFaceBlocks, parseUnicodeRange, rangeCovers } from '@open-artifact/export-kit';
import { nodeText, type DeckFace, type Slide, type SlideNode } from '@open-artifact/slides-core';
import { fontFaceRule } from '../../render/fonts.ts';
import { dataUrlBytes, fetchRetrying, type AssetCache } from './assets.ts';

/** Inlined font CSS and what could not be inlined. */
export interface FontBundle {
  /** `@font-face` rules with `data:` URLs. */
  css: string;
  /** Google Fonts stylesheets left to link (over budget or unreadable). */
  links: string[];
  /** Families that are missing from {@link css}. */
  missing: string[];
  /** Bytes of inlined font data. */
  bytes: number;
}

/** Every character a set of slides shows (plus printable ASCII). */
export function deckText(slides: readonly Slide[]): Set<number> {
  const points = new Set<number>();
  for (let c = 0x20; c < 0x7f; c++) points.add(c);
  const add = (text: string): void => {
    for (const char of text) points.add(char.codePointAt(0)!);
  };
  const visit = (node: SlideNode): void => {
    if (node.kind === 'svg') add(node.markup.replace(/<[^>]*>/g, ' '));
    else if (node.kind === 'box') node.children.forEach(visit);
    else add(nodeText(node));
  };
  for (const slide of slides) slide.children.forEach(visit);
  // Bullets and numbering.
  add('•–—’“”…');
  return points;
}

/** Inlines the faces as CSS within a byte budget. */
export async function deckFontCss(
  faces: Readonly<Record<string, DeckFace>>,
  options: { text: ReadonlySet<number>; assets: AssetCache; maxBytes: number },
): Promise<FontBundle> {
  const bundle: FontBundle = { css: '', links: [], missing: [], bytes: 0 };
  const rules: string[] = [];
  for (const face of Object.values(faces)) {
    if (face.href) {
      const css = await fetchRetrying(face.href)
        .then((response) => (response.ok ? response.text() : null))
        .catch(() => null);
      if (!css) {
        bundle.links.push(face.href);
        bundle.missing.push(face.family);
        continue;
      }
      const kept: string[] = [];
      const before = bundle.bytes;
      let complete = true;
      for (const block of fontFaceBlocks(css)) {
        if (!rangeCovers(parseUnicodeRange(blockUnicodeRange(block)), options.text)) continue;
        let rule = block;
        for (const { match, url } of cssUrls(block)) {
          const data = await options.assets.dataUrl(new URL(url, face.href).href);
          const size = data ? dataUrlBytes(data) : 0;
          if (!data || bundle.bytes + size > options.maxBytes) {
            complete = false;
            break;
          }
          bundle.bytes += size;
          rule = rule.replace(match, `url("${data}")`);
        }
        if (!complete) break;
        kept.push(rule);
      }
      if (complete) rules.push(...kept);
      else {
        bundle.bytes = before;
        bundle.links.push(face.href);
        bundle.missing.push(face.family);
      }
    } else if (face.src) {
      const data = await options.assets.dataUrl(face.src);
      const size = data ? dataUrlBytes(data) : 0;
      if (!data || bundle.bytes + size > options.maxBytes) {
        bundle.missing.push(face.family);
        continue;
      }
      bundle.bytes += size;
      rules.push(fontFaceRule(face, data));
    }
  }
  bundle.css = rules.join('\n');
  return bundle;
}
