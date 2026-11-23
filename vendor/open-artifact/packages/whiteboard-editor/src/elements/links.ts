/**
 * Where board links and assets point:
 *
 * - link cards and linked pictures hold `open-artifact://artifact/<id>` or an
 *   `http(s)` URL; artifact addresses open the artifact in the Open
 *   Artifacts Shell (`<shell>/a/<id>`);
 * - uploaded pictures and videos are stored as `/_blob/<id>`, which every
 *   Open Artifact host serves from its root (the runtime's asset
 *   contract), so they load as stored;
 * - inline images (`data:`) pass through unchanged.
 */

import { maybeSession } from '../services/session.ts';
import { normalizeLinkHref } from '@open-artifact/whiteboard-core';

/** The prefix of artifact addresses. */
export const ARTIFACT_ADDRESS_PREFIX = 'open-artifact://artifact/';

/** The id in an artifact address, or `undefined` for other links. */
export function artifactIdOf(href: string): string | undefined {
  if (!href.startsWith(ARTIFACT_ADDRESS_PREFIX)) return undefined;
  const id = href.slice(ARTIFACT_ADDRESS_PREFIX.length).split(/[/?#]/)[0];
  return id === undefined || id === '' ? undefined : id;
}

/**
 * The URL a board link opens: artifacts under the Shell's origin (or this
 * page's origin when the page is not framed), web links as they are.
 * `undefined` for links the board does not open.
 */
export function boardLinkTarget(href: string, shellOrigin?: string | null, pageOrigin?: string): string | undefined {
  const normalized = normalizeLinkHref(href);
  if (normalized === undefined) return undefined;
  const artifact = artifactIdOf(normalized);
  if (artifact === undefined) return /^https?:\/\//i.test(normalized) ? normalized : undefined;
  const origin = shellOrigin ?? maybeSession()?.shell?.origin ?? pageOrigin ?? (typeof location === 'undefined' ? '' : location.origin);
  return `${origin}/a/${encodeURIComponent(artifact)}`;
}

/** The text shown for a link's address: the host and path of a web link, else the address. */
export function linkDisplayUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return href;
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return href;
  }
}

/**
 * The URL a picture or video source loads from. Uploads (`/_blob/<id>`)
 * are served from the host's root, so every source loads as stored; this
 * is the one place to change should a host serve them elsewhere.
 */
export function resolveAssetUrl(src: string): string {
  return src;
}

/** Opens a board link in a new tab (no opener). */
export function openBoardLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * The link under a pressed DOM node (a link card, a linked picture or a
 * link inside text), for tools that open links on Mod-click or a tap.
 */
export function linkHrefAt(target: EventTarget | null): string | undefined {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return undefined;
  const anchor = target.closest('a[href]');
  return anchor instanceof HTMLAnchorElement ? anchor.href : undefined;
}
