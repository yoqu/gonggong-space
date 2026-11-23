/**
 * {@link LinkCard}: the card under a link in rich text being edited. It shows
 * the address, and Open, Copy link, Edit and Remove. Editing the address
 * saves on Enter and puts it back on Escape; Escape on the card gives the
 * focus back to the text.
 *
 * The editor brings what differs: what a typed address becomes
 * (`normalize`), how it is copied and how the link changes.
 */

import { Copy, ExternalLink, Pencil, Unlink } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { IconButton } from './button.tsx';
import { cn } from './cn.ts';
import { INPUT_CLASS } from './fields.tsx';
import { isComposingKey } from './keys.ts';
import { canOpenLink, placeLinkCard, shownLink } from './link-card.ts';

/** Props of {@link LinkCard}. */
export interface LinkCardProps {
  /** The link in the text; the card sits under it. */
  link: HTMLElement;
  /** The address as the document writes it: shown, copied and edited. */
  target: string;
  /** The address resolved, which Open goes to. */
  href: string;
  /** What a typed address becomes, or null when it cannot be one. */
  normalize(typed: string): string | null;
  /** Shown under an address `normalize` refused. */
  invalidMessage?: string;
  onCopy(target: string): void;
  /** Writes a new address into the link; returns false when it could not. */
  onEdit(target: string): boolean;
  onRemove(): void;
  /** Gives focus back to the text, with the caret in the link. */
  onReturn(): void;
  className?: string;
}

const keepTextFocus = (event: MouseEvent): void => event.preventDefault();

export function LinkCard({ link, target, href, normalize, invalidMessage = 'Not a link address', onCopy, onEdit, onRemove, onReturn, className }: LinkCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const shown = shownLink(target);
  const openable = canOpenLink(href);

  useLayoutEffect(() => {
    const measure = () => {
      if (!card.current || !link.isConnected) return;
      const box = card.current.getBoundingClientRect();
      setPlace(placeLinkCard(link.getBoundingClientRect(), box, { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [link, editing]);

  const startEdit = () => {
    setDraft(target);
    setInvalid(false);
    setEditing(true);
  };
  const save = () => {
    const next = normalize(draft);
    if (next === null) {
      setInvalid(true);
      return;
    }
    if (next !== target && !onEdit(next)) return;
    setEditing(false);
    if (next === target) onReturn();
  };

  return (
    <div
      ref={card}
      role="dialog"
      aria-label="Link"
      data-link-card=""
      className={cn('fixed z-50 flex max-w-[min(420px,calc(100vw-12px))] items-center gap-1 rounded-control border border-line bg-surface p-1 text-[12px] shadow-lg', className)}
      style={place ? { top: place.top, left: place.left } : { top: -9999, left: -9999 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isComposingKey(event.nativeEvent)) {
          event.preventDefault();
          event.stopPropagation();
          if (editing) setEditing(false);
          onReturn();
        }
      }}
    >
      {editing ? (
        <>
          <input
            autoFocus
            aria-label="Link address"
            aria-invalid={invalid || undefined}
            value={draft}
            spellCheck={false}
            className={cn(INPUT_CLASS, 'h-7 w-72 font-mono text-[12px]', invalid && 'border-danger')}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || isComposingKey(event.nativeEvent)) return;
              event.preventDefault();
              save();
            }}
          />
          {invalid ? <span role="alert" className="px-1 text-danger">{invalidMessage}</span> : null}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate px-1.5" title={target}>
            <span className="text-fg">{shown.site}</span>
            <span className="text-fg-subtle">{shown.rest}</span>
          </span>
          {openable ? (
            <IconButton size="sm" label="Open link" icon={<ExternalLink className="size-3.5" />} onMouseDown={keepTextFocus} onClick={() => window.open(href, '_blank', 'noopener,noreferrer')} />
          ) : null}
          <IconButton size="sm" label="Copy link" icon={<Copy className="size-3.5" />} onMouseDown={keepTextFocus} onClick={() => onCopy(target)} />
          <IconButton size="sm" label="Edit link" icon={<Pencil className="size-3.5" />} onClick={startEdit} />
          <IconButton size="sm" label="Remove link" icon={<Unlink className="size-3.5" />} onMouseDown={keepTextFocus} onClick={onRemove} />
        </>
      )}
    </div>
  );
}
