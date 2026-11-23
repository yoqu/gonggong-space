/**
 * The link card (see `services/link-card.ts`): the link's site and path,
 * Copy link, Edit link (for links in words the viewer may edit) and an
 * open control. A link the board does not open says so instead; one
 * with a user name or password shows greyed out.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ArrowUpRight, Check, Copy, Pencil } from 'lucide-react';
import { cn } from '@open-artifact/ui';
import { LINK_COPIED_MS, linkAddressParts, linkCardPlace, type LinkCardPlace } from '../lib/link-card.ts';
import { useLinkCard, type LinkCardView } from '../state/link-card.ts';
import { copyLinkAddress, editCardLink, hideLinkCard, installLinkCards, openCardLink, returnToLinkText, tabOutOfLinkCard } from '../services/link-card.ts';
import { Card, ToolButton } from './chrome.tsx';

/** Told on a card whose link the board does not open. */
export const LINK_BLOCKED_MESSAGE = "This link can't be opened from here.";

/** The card on show. */
export function LinkCard() {
  const card = useLinkCard((state) => state.card);
  useEffect(() => installLinkCards(), []);
  return card === null ? null : <LinkCardBody key={card.serial} card={card} />;
}

/** The selection bar's box, which the card keeps clear of. */
function selectionBarBox(): { x: number; y: number; w: number; h: number } | null {
  const bar = document.querySelector('[data-wb-bar="selection"]');
  if (!bar) return null;
  const rect = bar.getBoundingClientRect();
  return rect.width === 0 ? null : { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

function LinkCardBody({ card }: { card: LinkCardView }) {
  const root = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<LinkCardPlace | null>(null);
  const [copied, setCopied] = useState(false);
  const [cut, setCut] = useState(false);
  const parts = linkAddressParts(card.href);
  const disabled = card.blocked === 'credentials';

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    setPlace(linkCardPlace(card.anchor, { w: element.offsetWidth, h: element.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }, selectionBarBox()));
    const shown = address.current;
    setCut(shown !== null && [...shown.children].some((part) => part.scrollWidth > part.clientWidth));
  }, [card]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (card.origin === 'editor') returnToLinkText();
      hideLinkCard();
    } else if (event.key === 'Tab' && tabOutOfLinkCard(event.target as Element, event.shiftKey)) {
      event.preventDefault();
    }
  };

  const style: CSSProperties = place === null ? { left: 0, top: 0, visibility: 'hidden' } : { left: place.x, top: place.y };
  return (
    <Card
      ref={root}
      role="group"
      aria-label="Link details"
      data-wb-link-card=""
      data-side={place?.side}
      className="fixed z-[31] flex max-w-[min(420px,calc(100vw-16px))] items-center gap-1 p-1 pl-3"
      style={style}
      onKeyDown={keyDown}
    >
      <span
        ref={address}
        className={cn('flex min-w-0 flex-1 items-baseline text-[13px] leading-5', disabled ? 'text-chrome-muted line-through' : 'text-chrome-fg')}
        title={cut ? parts.full : undefined}
        aria-disabled={disabled ? true : undefined}
        data-wb-link-address=""
      >
        <span className="max-w-[70%] shrink-0 truncate font-medium">{parts.host}</span>
        {parts.path !== '' ? <span className="min-w-[3ch] truncate text-chrome-muted">{parts.path}</span> : null}
      </span>
      {card.blocked !== undefined ? <span className="shrink-0 px-1 text-[12px] text-chrome-muted">{LINK_BLOCKED_MESSAGE}</span> : null}
      <ToolButton
        size="lg"
        label={copied ? 'Link copied' : 'Copy link'}
        tipSide="bottom"
        icon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        onClick={() => {
          void copyLinkAddress().then((done) => {
            if (done) setCopied(true);
          });
        }}
      />
      {card.editable ? <ToolButton size="lg" label="Edit link" tipSide="bottom" icon={<Pencil aria-hidden="true" />} onClick={() => editCardLink()} /> : null}
      {card.target !== undefined ? (
        <ToolButton size="lg" label="Open link" tip="Opens in a new tab" tipSide="bottom" aria-description="Opens in a new tab" icon={<ArrowUpRight aria-hidden="true" />} onClick={() => openCardLink()} />
      ) : null}
    </Card>
  );
}
