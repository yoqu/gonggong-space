/** What an address typed into the link card becomes on a slide. */

import { isSafeHref } from '@open-artifact/slides-core';

/** The link written for a typed address (https added to a bare host), or null when a slide cannot keep it. */
export function typedLink(raw: string): string | null {
  const typed = raw.trim();
  if (!typed) return null;
  const href = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
  return isSafeHref(href) ? href : null;
}
