/**
 * How the link card shows an address, what it may open and where it goes.
 * What a typed address becomes is the editor's own rule (see {@link LinkCard}).
 */

/** The address split for display: the site in front, the rest after it. */
export function shownLink(target: string): { site: string; rest: string } {
  const web = /^https?:\/\/([^/?#]+)(.*)$/i.exec(target);
  if (web) return { site: web[1]!.replace(/^www\./i, ''), rest: web[2] === '/' ? '' : web[2]! };
  const mail = /^mailto:(.*)$/i.exec(target);
  if (mail) {
    try {
      return { site: decodeURIComponent(mail[1]!), rest: '' };
    } catch {
      return { site: mail[1]!, rest: '' };
    }
  }
  return { site: target, rest: '' };
}

/** Whether a resolved address may be opened from the card. */
export function canOpenLink(resolved: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(resolved).protocol);
  } catch {
    return false;
  }
}

/** Where the card goes: below the link, or above it when below would leave the window. */
export function placeLinkCard(link: { top: number; bottom: number; left: number }, card: { width: number; height: number }, window: { width: number; height: number }, gap = 6): { top: number; left: number } {
  const below = link.bottom + gap;
  const above = link.top - gap - card.height;
  const top = below + card.height <= window.height - gap || above < gap ? below : above;
  const left = Math.max(gap, Math.min(link.left, window.width - card.width - gap));
  return { top, left };
}
