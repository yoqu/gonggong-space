/**
 * A link on the board: a link in text, a link card or a linked picture's
 * corner. Pointer clicks never follow the anchor itself; the Select tool
 * opens the link (`services/link-card.ts`: after a short delay unless a
 * double click follows, at once on a Mod-click), and resting on it shows
 * its card. Enter on a focused link opens it.
 *
 * `data-wb-link` holds the stored address, which the card and the
 * opening read.
 */

import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { openLink } from '../services/link-card.ts';

/** Props of {@link PassiveLink}: an anchor's props with a required `href`. */
export interface PassiveLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** The stored address, when `href` is what it opens (an artifact address resolved to the Shell). */
  link?: string;
}

/** A board link that opens only when meant to (see the module comment). */
export function PassiveLink({ href, link, children, onClick, ...rest }: PassiveLinkProps) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const followed = !event.defaultPrevented;
    event.preventDefault();
    // A click from the keyboard (Enter) has no pointer press behind it.
    if (followed && event.detail === 0) openLink(link ?? href);
  };
  return (
    <a {...rest} href={href} data-wb-link={link ?? href} target="_blank" rel="noopener noreferrer" draggable={false} onClick={click}>
      {children}
    </a>
  );
}
