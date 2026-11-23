/**
 * @open-artifact/export-kit: the capture and export code the Slides, Design
 * and Whiteboard editors share in the browser.
 *
 * - capture.ts: DOM to pictures (inlined copies drawn through
 *   `<foreignObject>`, or dom-to-svg) and capture size limits;
 * - measure.ts and text-layer.ts: the PDF text layer (words and links
 *   measured on a rendered page, words grouped into lines);
 * - pictures.ts: `data:` URLs, canvas encoding, decoding and shrinking pictures;
 * - fonts.ts: reading font stylesheets for inlined `@font-face` rules;
 * - font-embed.ts: the web fonts a rendered document uses, inlined for pictures of it;
 * - font-subset.ts: a TrueType font cut down to the ideographs and Hangul a document uses.
 *
 * It never imports an editor or a document model; each editor passes its
 * own limits and policies. The pure modules (text-layer.ts, fonts.ts,
 * font-subset.ts) load in `node --test`.
 */

export * from './capture.ts';
export * from './font-embed.ts';
export * from './font-subset.ts';
export * from './fonts.ts';
export * from './measure.ts';
export * from './pictures.ts';
export * from './text-layer.ts';
