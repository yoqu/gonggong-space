/**
 * Slide links: `#slide-~<id>`, older `#slide-<page number>`, and
 * `#slide-~<id>.only`, which opens the slide on its own and is reported back
 * as `.only.<position>.<count>`.
 */

import { SLIDE_FRAGMENT } from '@open-artifact/protocol';

/** A slide shown on its own: where it is among the slides a show plays. */
export interface OnlyPlace {
  position: number;
  count: number;
}

/** What a slide link points at. */
export interface SlideLink {
  /** A slide id, or a one-based page number. */
  target: { id: string } | { page: number };
  /** The slide shows on its own. */
  only: boolean;
}

/** What follows a slide's link to show it on its own, with where it is once shown. */
export function onlySuffix(place?: OnlyPlace): string {
  return `.only${place ? `.${place.position}.${place.count}` : ''}`;
}

export function readSlideLink(hash: string): SlideLink | null {
  if (!SLIDE_FRAGMENT.test(hash)) return null;
  const [value = '', suffix] = hash.slice('#slide-'.length).split('.', 2);
  const only = suffix === 'only';
  return value.startsWith('~') ? { target: { id: value.slice(1) }, only } : { target: { page: Number(value) }, only };
}

/** The slide a link points at in a deck of this order, or null when it is not there. */
export function linkedSlide(link: SlideLink, order: readonly string[]): string | null {
  if ('id' in link.target) return order.includes(link.target.id) ? link.target.id : null;
  return order[link.target.page - 1] ?? null;
}

/** True when a keyboard event triggers Copy link to slide (⌘⌥L on macOS, Ctrl+Alt+L elsewhere, never Ctrl+⌘+⌥+L). */
export function isCopySlideLinkKey(event: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string; key: string }): boolean {
  if (!event.altKey) return false;
  if (event.metaKey && event.ctrlKey) return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  return event.code === 'KeyL' || event.key.toLowerCase() === 'l';
}
