/**
 * Loads the deck's typefaces (`deck.json` `faces`) into a document: Google
 * Fonts stylesheets as `<link>`s, uploaded or installed files as
 * `@font-face` rules. Idempotent per document; faces that leave the index are
 * removed.
 */

import { isFontHref, type DeckFace } from '@open-artifact/slides-core';

const MARK = 'data-open-artifact-face';

/** CSS string literal. */
function quote(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}

/** The `@font-face` rule of a face backed by a file. */
export function fontFaceRule(face: DeckFace, url: string): string {
  return `@font-face{font-family:${quote(face.family)};src:url(${quote(url)});font-display:swap}`;
}

/** Brings a document's face elements in line with the deck's faces. */
export function syncDeckFonts(faces: Readonly<Record<string, DeckFace>>, resolveSrc: (src: string) => string, doc: Document = document): void {
  const wanted = new Map<string, () => HTMLElement>();
  for (const [key, face] of Object.entries(faces)) {
    if (face.href && isFontHref(face.href)) {
      const href = face.href;
      wanted.set(`${key}|href|${href}`, () => {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        return link;
      });
    } else if (face.src) {
      const url = resolveSrc(face.src);
      wanted.set(`${key}|src|${url}`, () => {
        const style = doc.createElement('style');
        style.textContent = fontFaceRule(face, url);
        return style;
      });
    }
  }
  for (const el of Array.from(doc.head.querySelectorAll<HTMLElement>(`[${MARK}]`))) {
    const id = el.getAttribute(MARK)!;
    if (wanted.has(id)) wanted.delete(id);
    else el.remove();
  }
  for (const [id, make] of wanted) {
    const el = make();
    el.setAttribute(MARK, id);
    doc.head.appendChild(el);
  }
}

/** The families of the faces still loading, unquoted, each once. */
export function lateFontFamilies(faces: Iterable<{ family: string; status: string }>): string[] {
  const late = [...faces].filter((face) => face.status === 'loading').map((face) => face.family.replace(/^\s*["']|["']\s*$/g, '').trim());
  return [...new Set(late)].filter(Boolean);
}

/**
 * Resolves once the document's fonts finished loading, or after `timeout` ms
 * with the families still loading then (empty when all are in).
 */
export async function fontsReady(doc: Document = document, timeout = 4000): Promise<string[]> {
  const fonts = doc.fonts;
  if (!fonts) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), timeout);
  });
  const settled = await Promise.race([fonts.ready.then(() => 'ready' as const), late]).finally(() => clearTimeout(timer));
  return settled === 'ready' ? [] : lateFontFamilies(fonts);
}
