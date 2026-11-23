/**
 * Which image sources an element may use, and the SVG checks behind them.
 *
 * An image's `src` is one of:
 * - an upload, `/_blob/<32 hex>` (or `_blob/…`);
 * - a small inline raster, `data:image/(webp|jpeg|png);base64,…`;
 * - an SVG drawing as base64, `data:image/svg+xml;base64,…`.
 *
 * Agents write drawings as text data URIs (`data:image/svg+xml,<svg…>`);
 * those are checked (one root `<svg>` with the SVG namespace and a positive
 * viewBox, no `#`, no control characters, parses as XML) and stored as
 * base64. An invalid `src` reads back as an empty SVG, so one bad element
 * never breaks the board.
 */

import { MAX_RASTER_DATA_URL_CHARS, MAX_TEXT_CHARS } from './schema.ts';
import { truncateMarkdownText } from './text-limits.ts';

export const RASTER_DATA_URL_PATTERN = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
export const SVG_BASE64_DATA_URL_PATTERN = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/;
/** Longest SVG source accepted. */
export const MAX_SVG_SOURCE_CHARS = 36_000;
/** Longest SVG data URL (base64 or text). */
export const MAX_SVG_DATA_URL_CHARS = 49_152;
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
/** Parsing under a private namespace keeps the browser from treating the document as live SVG. */
const SVG_PARSE_NAMESPACE = 'urn:whiteboard:svg';
const SVG_ROOT_TAG_PATTERN =
  /^<svg(?:[ \t\r\n]+(?:(?:xml|xlink|xmlns):)?[A-Za-z_][\w.-]*[ \t\r\n]*=[ \t\r\n]*(?:"[^"<&]*"|'[^'<&]*'))*[ \t\r\n]*>/;
export const SVG_CONTROL_CHAR_PATTERN = /[\0-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/;
const XLINK_NAMESPACE_ATTR_PATTERN = /\sxmlns:xlink\s*=\s*(["'])http:\/\/www\.w3\.org\/1999\/xlink\1/;
const SVG_ATTR_WITH_LT_PATTERN =
  /(?:^|[\s=>/])(?=[^\s=>/]*?<[^\s!?/<>=])[^\s=>/]*(?:\s+[^\s=>/]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s+[^\s=>/]+\s*=\s*(?:"[^"<]*<|'[^'<]*<)/;
const SVG_TEXT_DATA_URL_PATTERN = /^data:image\/svg\+xml(?:;utf8|;charset=utf-8)?,/;
/** An upload of this artifact. */
export const UPLOADED_BLOB_PATH_PATTERN = /^\/?_blob\/[0-9a-f]{32}$/;
/** What an invalid `src` reads back as. */
export const EMPTY_SVG_DATA_URL = 'data:image/svg+xml;base64,PHN2Zy8+';

/** Why an SVG source was refused, or its viewBox when accepted. */
export type SvgCheck = 'long' | 'svg' | 'broken' | { x: number; y: number; w: number; h: number };

/** Base64 of bytes, in chunks (no call-stack limit on big inputs). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

/** True for an inline raster within the size cap. */
export function isRasterDataUrl(src: string): boolean {
  return src.length <= MAX_RASTER_DATA_URL_CHARS && RASTER_DATA_URL_PATTERN.test(src);
}

/** True for a base64 SVG within the size cap. */
export function isSvgBase64DataUrl(src: string): boolean {
  return src.length <= MAX_SVG_DATA_URL_CHARS && SVG_BASE64_DATA_URL_PATTERN.test(src);
}

/** True for an upload path. */
export function isUploadedBlobSource(src: string): boolean {
  return UPLOADED_BLOB_PATH_PATTERN.test(src);
}

/** An SVG text as a base64 data URL. */
export function svgToBase64DataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
}

/** The SVG text inside a base64 SVG data URL (`strict`: refuse invalid UTF-8). */
export function decodeSvgDataUrl(src: string, strict = false): string | undefined {
  if (!isSvgBase64DataUrl(src)) return undefined;
  try {
    const binary = atob(src.slice(src.indexOf(',') + 1));
    return new TextDecoder('utf-8', { fatal: strict, ignoreBOM: strict }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

/**
 * Parses an SVG with the browser's XML parser, when there is one. Refuses
 * doctypes, processing instructions and foreign namespaces outright.
 */
function parseSvgDocument(svg: string): Element | 'unread' | 'broken' {
  const body = svg.replace(
    /^<\?xml version=(["'])1\.0\1(?: encoding=(["'])[Uu][Tt][Ff]-8\2)?(?: standalone=(["'])(?:yes|no)\3)?[ \t\r\n]*\?>/,
    '',
  );
  if (/<!(?!--|\[CDATA\[)|<\?/.test(body) || body.split('xmlns').length > 4) return 'unread';
  for (const [, doubleQuoted, singleQuoted] of body.matchAll(/xmlns(?::[^\s=]*)?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const ns = doubleQuoted ?? singleQuoted;
    if (ns !== SVG_NAMESPACE && ns !== XLINK_NAMESPACE) return 'unread';
  }
  const doc = new DOMParser().parseFromString(body.replaceAll(SVG_NAMESPACE, SVG_PARSE_NAMESPACE), 'application/xml');
  return doc.querySelector('parsererror') === null && doc.documentElement.localName === 'svg' && doc.documentElement.namespaceURI === SVG_PARSE_NAMESPACE
    ? doc.documentElement
    : 'broken';
}

/**
 * Checks an SVG source: size, one `<svg>` root with exactly the SVG
 * namespace and a positive viewBox, no control characters, no `<` inside
 * attribute values, and (where a DOM parser exists) well-formed XML.
 */
export function checkSvgSource(svg: string): SvgCheck {
  if (svg.length > MAX_SVG_SOURCE_CHARS) return 'long';
  const rootTag = SVG_ROOT_TAG_PATTERN.exec(svg)?.[0];
  if (rootTag === undefined || !svg.endsWith('</svg>') || !/\sxmlns\s*=\s*(["'])http:\/\/www\.w3\.org\/2000\/svg\1/.test(rootTag)) return 'svg';
  if (
    rootTag
      .replace(XLINK_NAMESPACE_ATTR_PATTERN, '')
      .replace(/"[^"]*"|'[^']*'/g, '')
      .match(/\sxmlns/g)?.length !== 1
  ) {
    return 'svg';
  }
  const viewBox = /\sviewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/.exec(rootTag);
  const [x, y, w, h] = [Number(viewBox?.[1]), Number(viewBox?.[2]), Number(viewBox?.[3]), Number(viewBox?.[4])];
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return 'svg';
  const parsed = typeof DOMParser === 'undefined' ? null : parseSvgDocument(svg);
  return parsed !== 'broken' && !SVG_CONTROL_CHAR_PATTERN.test(svg) && !SVG_ATTR_WITH_LT_PATTERN.test(svg) ? { x, y, w, h } : 'broken';
}

const svgTextCache = new Map<string, string | undefined>();
const SVG_TEXT_CACHE_BUDGET = 4 * 1024 * 1024;
let svgTextCacheChars = 0;

/**
 * A text SVG data URL (`data:image/svg+xml,<svg …>`) as base64, when it
 * passes {@link checkSvgSource}. Percent escapes are decoded; a raw `#`
 * (an unescaped color) makes the URL invalid, as it would in a browser.
 */
export function svgTextToBase64DataUrl(src: string): string | undefined {
  const prefix = SVG_TEXT_DATA_URL_PATTERN.exec(src)?.[0];
  if (prefix === undefined || src.length > MAX_SVG_DATA_URL_CHARS || src.includes('#') || SVG_CONTROL_CHAR_PATTERN.test(src)) return undefined;
  if (svgTextCache.has(src)) return svgTextCache.get(src);
  if ((svgTextCacheChars += src.length) > SVG_TEXT_CACHE_BUDGET) {
    svgTextCache.clear();
    svgTextCacheChars = src.length;
  }
  const body = src.slice(prefix.length).replace(/[\t\n\r]/g, '');
  let binary: string;
  try {
    // UTF-8 bytes of the text, then percent escapes decoded byte-wise.
    binary = Array.from(new TextEncoder().encode(body), (byte) => String.fromCharCode(byte))
      .join('')
      .replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  } catch {
    svgTextCache.set(src, undefined);
    return undefined;
  }
  const dataUrl = `data:image/svg+xml;base64,${btoa(binary)}`;
  const decoded = decodeSvgDataUrl(dataUrl, true);
  const result = decoded === undefined || typeof checkSvgSource(decoded) === 'string' ? undefined : dataUrl;
  svgTextCache.set(src, result);
  return result;
}

/** True when `src` may be stored as is. */
export function isAllowedImageSource(src: string): boolean {
  return isRasterDataUrl(src) || isSvgBase64DataUrl(src) || isUploadedBlobSource(src);
}

/** The storable form of an image source, or `undefined` when it is not allowed. */
export function normalizeImageSource(src: unknown): string | undefined {
  const normalized = typeof src === 'string' ? (svgTextToBase64DataUrl(src) ?? src) : '';
  if (isUploadedBlobSource(normalized)) return normalized.startsWith('/') ? normalized : '/' + normalized;
  return isAllowedImageSource(normalized) ? normalized : undefined;
}

/** True when the image is an SVG drawing (not a photo or upload). */
export function isSvgImageSource(src: string): boolean {
  return isSvgBase64DataUrl(src);
}

/** Percent-escapes the characters that would break a Markdown link. */
export function percentEncodeMarkdownChars(url: string): string {
  return url.replace(/[()[\]\\`*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** An element's text, capped at {@link MAX_TEXT_CHARS} without breaking a link. */
export function clampElementText(text: string): string {
  return truncateMarkdownText(text, MAX_TEXT_CHARS);
}
