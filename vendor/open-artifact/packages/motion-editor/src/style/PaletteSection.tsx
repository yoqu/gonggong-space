import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { Tip, TipGroup } from '@open-artifact/editor-kit/react';
import { cn } from '@open-artifact/ui';
import { PALETTE_WORDS, type PaletteCard } from '@open-artifact/motion-core';
import type { PaletteView } from './palette-model.ts';
import { pickPalette } from './palette-actions.ts';

interface SwatchProps {
  name: string;
  card: PaletteCard;
  /** Reachable by Tab: the card on show, else the first when none is. */
  first: boolean;
  disabled: boolean;
  onPick: () => void;
}

function PaletteSwatch({ name, card, first, disabled, onPick }: SwatchProps): ReactElement {
  const even = card.role !== undefined;
  return (
    <Tip label={name}>
      <button
        type="button"
        role="radio"
        aria-checked={card.on}
        aria-label={name}
        tabIndex={card.on || first ? 0 : -1}
        disabled={disabled}
        onClick={() => {
          if (!card.on) onPick();
        }}
        className={cn(
          'relative flex h-7 w-full min-w-0 overflow-hidden rounded-md outline-none ring-offset-chrome',
          'focus-visible:ring-2 focus-visible:ring-chrome-focus focus-visible:ring-offset-2 disabled:opacity-50 pointer-coarse:h-10',
          card.on && 'ring-[1.5px] ring-chrome-fg',
        )}
      >
        {card.bars.map((bar, index) => (
          <span key={index} aria-hidden="true" className={index === 0 && !even ? 'flex-[2]' : 'flex-1'} style={{ background: bar }} />
        ))}
        {card.role?.theirs === true ? (
          <span aria-hidden="true" className="absolute left-1 top-1/2 -translate-y-1/2 rounded-sm bg-chrome/85 px-1 text-[10px] font-medium leading-4 text-chrome-fg">
            {PALETTE_WORDS.yours}
          </span>
        ) : null}
      </button>
    </Tip>
  );
}

/** Arrows, Home and End move along the cards and pick, as in any radio group. */
function moveAlong(event: KeyboardEvent<HTMLDivElement>): void {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  if (event.repeat) return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  if (radios.length === 0) return;
  const at = radios.findIndex((radio) => radio === event.target);
  const next = step === 0 ? (event.key === 'Home' ? radios[0] : radios[radios.length - 1]) : radios[(at + step + radios.length) % radios.length];
  next?.focus();
  next?.click();
}

/** The Palette section: the film's own palette, the ones it offers and turns of its hues, as cards to pick from. */
export function PaletteSection({ view, canEdit }: { view: PaletteView; canEdit: boolean }): ReactElement {
  const headingId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const on = view.states.findIndex((card) => card.on);

  // A pick by keyboard moves the focus with the card on show once the film has it.
  useEffect(() => {
    const group = groupRef.current;
    if (group?.contains(document.activeElement) === true) group.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }, [on]);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-[13px] leading-4 font-[520] text-chrome-fg">
        {PALETTE_WORDS.section}
      </h3>
      <div ref={groupRef} role="radiogroup" aria-labelledby={headingId} onKeyDown={moveAlong} className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3 py-1">
        <TipGroup>
          {view.states.map((card, index) => (
            <PaletteSwatch
              key={index}
              name={view.names[index] ?? ''}
              card={card}
              first={index === 0 && on < 0}
              disabled={!canEdit}
              onPick={() => {
                const choice = view.cards[index];
                if (choice !== undefined) pickPalette(choice);
              }}
            />
          ))}
        </TipGroup>
      </div>
    </section>
  );
}
