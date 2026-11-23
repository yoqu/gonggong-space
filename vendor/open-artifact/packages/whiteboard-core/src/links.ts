/**
 * Link cards: which addresses a card may point at, and how its title and
 * subtitle read.
 *
 * A card points at another artifact (`open-artifact://artifact/<id>`) or at a web page
 * (`http(s)://…`, no credentials, no whitespace or control characters).
 */

import { ARTIFACT_ID } from '@open-artifact/protocol';
import { LINK_KIND_LABELS, LINK_KINDS, MAX_IMAGE_HREF_CHARS, MAX_LINK_HREF_CHARS, MAX_LINK_TITLE_CHARS, type LinkElement, type LinkKind } from './schema.ts';
import { percentEncodeMarkdownChars } from './image-source.ts';

/** A title must show at least one letter, digit, symbol or punctuation mark. */
const VISIBLE_TITLE_CHAR_PATTERN = /[\p{L}\p{N}\p{S}\p{P}]/u;

/** True for a link-card kind. */
export function isLinkKind(kind: unknown): kind is LinkKind {
  return typeof kind === 'string' && (LINK_KINDS as readonly string[]).includes(kind);
}

/**
 * An `http(s)` URL that is safe to show and open: no whitespace or control
 * characters, no credentials, Markdown-breaking characters escaped.
 */
export function normalizeHttpUrl(href: unknown, maxChars = MAX_IMAGE_HREF_CHARS): string | undefined {
  const url = typeof href === 'string' ? percentEncodeMarkdownChars(href) : '';
  if (url.length > maxChars || !/^https?:\/\/[^\s\p{Cc}\p{Cf}﷐-﷔]+$/u.test(url)) return undefined;
  try {
    const { username, password } = new URL(url);
    return username === '' && password === '' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The canonical `open-artifact://artifact/<id>` form of an artifact address, if it is one. */
export function normalizeArtifactAddress(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  const text = href.trim();
  if (text.length > MAX_LINK_HREF_CHARS || /[\s\p{Cc}]/u.test(text)) return undefined;
  const match = /^open-artifact:\/\/artifact\/([^/?#]+)$/.exec(text);
  return match !== null && ARTIFACT_ID.test(match[1]!) ? text : undefined;
}

/** A link card's address: an artifact address or a web URL. */
export function normalizeLinkHref(href: unknown): string | undefined {
  return normalizeArtifactAddress(href) ?? normalizeHttpUrl(href, MAX_LINK_HREF_CHARS);
}

/** True when the card points at another artifact. */
export function isArtifactLink(href: string): boolean {
  return normalizeArtifactAddress(href) !== undefined;
}

/** A short one-line label: whitespace collapsed, invisible characters dropped, capped at `maxChars`. */
export function sanitizeShortLabel(label: unknown, maxChars: number): string {
  if (typeof label !== 'string') return '';
  const value = label
    .replace(/\s+/g, ' ')
    .replace(/(?![‌‍\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ +/g, ' ')
    .trim();
  return VISIBLE_TITLE_CHAR_PATTERN.test(value) ? [...value].slice(0, maxChars).join('').trim() : '';
}

/** A card title: whitespace collapsed, invisible characters dropped, capped. */
export function sanitizeLinkTitle(title: unknown): string {
  return sanitizeShortLabel(title, MAX_LINK_TITLE_CHARS);
}

/** The link fields of a card, or `undefined` when its address is not allowed. Legacy `kind: "board"` reads as `whiteboard`. */
export function normalizeLinkFields(input: { href?: unknown; title?: unknown; kind?: unknown }): Pick<LinkElement, 'href' | 'title' | 'kind'> | undefined {
  const href = normalizeLinkHref(input.href);
  if (href === undefined) return undefined;
  const title = sanitizeLinkTitle(input.title);
  const kind = input.kind === 'board' ? 'whiteboard' : input.kind;
  return {
    href,
    ...(title !== '' ? { title } : {}),
    ...(isLinkKind(kind) ? { kind } : isArtifactLink(href) ? {} : { kind: 'web' as const }),
  };
}

/** A label for the card's kind (`Artifact` when unknown). */
export function linkKindLabel(link: Pick<LinkElement, 'kind'>, live?: { kind?: LinkKind }): string {
  const kind = live?.kind ?? link.kind;
  return kind === undefined ? 'Artifact' : LINK_KIND_LABELS[kind];
}

/** The title a card shows: the live title, its stored title, or its kind. */
export function linkTitle(link: Pick<LinkElement, 'kind' | 'title'>, live?: { kind?: LinkKind; title?: string }): string {
  return live?.title ?? link.title ?? linkKindLabel(link, live);
}

/** The line under a card's title: its kind, or its address when untitled. */
export function linkSubtitle(link: Pick<LinkElement, 'kind' | 'title' | 'href'>, live?: { kind?: LinkKind; title?: string }): string {
  return (live?.title ?? link.title) === undefined ? (link.href.split('?')[0] ?? link.href).replace(/^https?:\/\//, '') : linkKindLabel(link, live);
}
