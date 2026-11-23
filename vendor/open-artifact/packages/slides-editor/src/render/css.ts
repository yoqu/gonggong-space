/**
 * Style conversion for the renderer: the model's normalized declarations
 * (`StyleMap`) become React style objects, and one stylesheet carries the
 * subset's defaults (tag sizes, flex columns, table rules).
 *
 * Text fitting: every font size (and px line height) is written as
 * `calc(Npx * var(--open-artifact-fit, 1))`, so a squeezed box shrinks all the text it
 * holds by setting one custom property on itself (see fit.ts).
 */

import type { CSSProperties } from 'react';
import { DEFAULT_FONT_STACK, SLIDE_HEIGHT, SLIDE_WIDTH, type ItemMargin, type StyleMap } from '@open-artifact/slides-core';

/** Section declarations that lay out its flow children (they go on the flow root). */
export const SECTION_LAYOUT = new Set<string>([
  'display',
  'flex-direction',
  'flex-wrap',
  'gap',
  'align-items',
  'justify-content',
  'justify-items',
  'grid-template-columns',
  'grid-template-rows',
  'padding',
]);

/** `-webkit-text-fill-color` → `WebkitTextFillColor`, `font-size` → `fontSize`. */
function camel(property: string): string {
  const name = property.startsWith('-webkit-') ? `Webkit-${property.slice(8)}` : property;
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Scales a px length by the fit factor. */
export function fitted(value: string): string {
  return /^-?[\d.]+px$/.test(value) ? `calc(${value} * var(--open-artifact-fit, 1))` : value;
}

/** Options of {@link toReactStyle}. */
export interface StyleOptions {
  /** Drop these properties (e.g. section layout or pinned offsets handled elsewhere). */
  omit?: ReadonlySet<string>;
  /** Keep only these properties. */
  only?: ReadonlySet<string>;
  /** Resolves `url(…)` references inside backgrounds. */
  resolveUrl?: (url: string) => string;
}

/** A list's style with the margin of its items, which the slide stylesheet gives every `<li>` under it. */
export function withItemMargin(style: CSSProperties, margin: ItemMargin | undefined): CSSProperties {
  if (!margin) return style;
  return { ...style, '--open-artifact-item-top': `${margin.top}px`, '--open-artifact-item-bottom': `${margin.bottom}px` } as CSSProperties;
}

/** Converts a style map into a React style object. */
export function toReactStyle(style: StyleMap, options: StyleOptions = {}): CSSProperties {
  const out: Record<string, string> = {};
  for (const [property, raw] of Object.entries(style) as [string, string][]) {
    if (options.omit?.has(property)) continue;
    if (options.only && !options.only.has(property)) continue;
    let value = raw;
    if (property === 'font-size') value = fitted(value);
    else if (property === 'line-height' && value.endsWith('px')) value = fitted(value);
    else if ((property === 'background' || property === 'background-image') && options.resolveUrl && value.includes('url(')) {
      value = value.replace(/url\((['"]?)([^'")]+)\1\)/g, (_, q: string, url: string) => `url(${q}${options.resolveUrl!(url)}${q})`);
    }
    out[camel(property)] = value;
  }
  return out as CSSProperties;
}

/** Root class of a rendered slide. */
export const SLIDE_CLASS = 'open-artifact-slide';

/** Build effects: the transform an element enters from / leaves to. */
const BUILD_FROM: Record<string, string> = {
  fade: 'none',
  rise: 'translateY(48px)',
  drop: 'translateY(-48px)',
  left: 'translateX(-96px)',
  right: 'translateX(96px)',
  scale: 'scale(0.85)',
  pop: 'scale(0.6)',
};

/** Duration of one build step in ms. */
export const BUILD_MS = 450;

const buildRules = Object.entries(BUILD_FROM)
  .map(
    ([effect, from]) =>
      `@keyframes open-artifact-in-${effect}{from{opacity:0;translate:none;transform:${from}}}` +
      `@keyframes open-artifact-out-${effect}{to{opacity:0;transform:${from}}}` +
      `.${SLIDE_CLASS} .open-artifact-build-in.open-artifact-fx-${effect}{animation:open-artifact-in-${effect} ${BUILD_MS}ms cubic-bezier(.2,.7,.2,1) both}` +
      `.${SLIDE_CLASS} .open-artifact-build-out.open-artifact-fx-${effect}{animation:open-artifact-out-${effect} ${BUILD_MS}ms ease-in both}`,
  )
  .join('\n');

/**
 * The subset's defaults, scoped to rendered slides, at the deck's current
 * slide size (`SLIDE_WIDTH` follows deck.json `size`).
 */
export function slideStylesheet(): string {
  if (cachedSheet?.width !== SLIDE_WIDTH) cachedSheet = { width: SLIDE_WIDTH, css: SLIDE_STYLESHEET_BASE.replace('width:1920px', `width:${SLIDE_WIDTH}px`) };
  return cachedSheet.css;
}
let cachedSheet: { width: number; css: string } | undefined;

/** The stylesheet at 16:9 (see {@link slideStylesheet}). */
const SLIDE_STYLESHEET_BASE = `
.${SLIDE_CLASS}{position:relative;width:1920px;height:${SLIDE_HEIGHT}px;overflow:hidden;box-sizing:border-box;
  font-family:${DEFAULT_FONT_STACK};font-size:calc(32px * var(--open-artifact-fit, 1));line-height:1.2;font-weight:400;color:#000;background:#fff;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;contain:layout paint;isolation:isolate;text-align:left;flex:none}
.${SLIDE_CLASS} *,.${SLIDE_CLASS} *::before,.${SLIDE_CLASS} *::after{box-sizing:border-box}
.${SLIDE_CLASS} .open-artifact-flow{position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0}
.${SLIDE_CLASS} h1,.${SLIDE_CLASS} h2,.${SLIDE_CLASS} h3,.${SLIDE_CLASS} p,.${SLIDE_CLASS} ul,.${SLIDE_CLASS} ol{margin:0;min-width:0;min-height:0;overflow-wrap:break-word}
.${SLIDE_CLASS} h1{font-size:calc(96px * var(--open-artifact-fit, 1));font-weight:600;line-height:1.1}
.${SLIDE_CLASS} h2{font-size:calc(64px * var(--open-artifact-fit, 1));font-weight:600;line-height:1.2}
.${SLIDE_CLASS} h3{font-size:calc(44px * var(--open-artifact-fit, 1));font-weight:600;line-height:1.2}
.${SLIDE_CLASS} ul,.${SLIDE_CLASS} ol{padding-left:1.25em}
.${SLIDE_CLASS} ul{list-style-type:disc}
.${SLIDE_CLASS} ol{list-style-type:decimal}
.${SLIDE_CLASS} ul ul{list-style-type:circle}
.${SLIDE_CLASS} ul ul ul{list-style-type:square}
.${SLIDE_CLASS} ol ol{list-style-type:lower-alpha}
.${SLIDE_CLASS} ol ol ol{list-style-type:lower-roman}
.${SLIDE_CLASS} li{margin-top:var(--open-artifact-item-top, 0);margin-bottom:var(--open-artifact-item-bottom, 0)}
.${SLIDE_CLASS} li[data-level]{margin-left:calc(var(--open-artifact-level) * 1.25em)}
.${SLIDE_CLASS} li::marker{color:currentColor}
.${SLIDE_CLASS} a{color:inherit;text-decoration:underline}
.${SLIDE_CLASS} .open-artifact-box,.${SLIDE_CLASS} .open-artifact-textbox,.${SLIDE_CLASS} .open-artifact-tablebox{display:flex;flex-direction:column;min-width:0;min-height:0}
.${SLIDE_CLASS} .open-artifact-textbox>*{flex:none}
.${SLIDE_CLASS} .open-artifact-textbox ul,.${SLIDE_CLASS} .open-artifact-textbox ol{padding-left:var(--open-artifact-indent, 1.25em)}
.${SLIDE_CLASS} .open-artifact-table{border-collapse:collapse;table-layout:fixed;width:100%;font:inherit;color:inherit}
.${SLIDE_CLASS} .open-artifact-table th,.${SLIDE_CLASS} .open-artifact-table td{border:1px solid color-mix(in srgb, currentColor 25%, transparent);padding:0.35em 0.6em;vertical-align:top;text-align:left;overflow-wrap:break-word}
.${SLIDE_CLASS} .open-artifact-table th{font-weight:600}
.${SLIDE_CLASS} .open-artifact-img{position:relative;overflow:hidden;display:block;flex:none}
.${SLIDE_CLASS} .open-artifact-img>img,.${SLIDE_CLASS} .open-artifact-img>video{display:block;max-width:none}
.${SLIDE_CLASS} .open-artifact-media-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(45deg,#0000000a 0 16px,#00000005 16px 32px);color:#00000059;outline:2px dashed #00000026;outline-offset:-2px}
.${SLIDE_CLASS} .open-artifact-clip-badge{position:absolute;right:16px;bottom:16px;display:flex;padding:8px;border-radius:999px;background:#000000a0;color:#fff}
.${SLIDE_CLASS} .open-artifact-clip-start{position:absolute;inset:0;margin:auto;width:144px;height:144px;border-radius:999px;border:0;background:#000000a0;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}
.${SLIDE_CLASS} .open-artifact-contents{display:contents}
.${SLIDE_CLASS} svg[data-open-artifact-kind="svg"]{display:block;flex:none}
.${SLIDE_CLASS} .open-artifact-icon{flex:none;display:block}
.${SLIDE_CLASS} .open-artifact-icon>svg{display:block;width:100%;height:100%}
.${SLIDE_CLASS} .open-artifact-shape{flex:none;display:block}
.${SLIDE_CLASS} .open-artifact-connector{flex:none}
.${SLIDE_CLASS} .open-artifact-embed{border:0;background:transparent;display:block}
.${SLIDE_CLASS} .open-artifact-embed-still{background:repeating-linear-gradient(45deg,#0000000a 0 16px,#00000005 16px 32px)}
.${SLIDE_CLASS} .open-artifact-rule{flex:none;align-self:stretch;height:0;margin:0;border:0;border-top:2px solid currentColor}
.${SLIDE_CLASS} [data-open-artifact-clip]{overflow:hidden}
.${SLIDE_CLASS} .open-artifact-build-hidden{visibility:hidden}
${buildRules}
@media (prefers-reduced-motion: reduce){.${SLIDE_CLASS} .open-artifact-build-in,.${SLIDE_CLASS} .open-artifact-build-out{animation-duration:1ms}}
`;

/** Installs the slide stylesheet into a document, or brings it to the current slide size. */
export function installSlideStyles(doc: Document = document): void {
  const css = slideStylesheet();
  const existing = doc.getElementById('open-artifact-slide-styles');
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css;
    return;
  }
  const el = doc.createElement('style');
  el.id = 'open-artifact-slide-styles';
  el.textContent = css;
  doc.head.appendChild(el);
}
