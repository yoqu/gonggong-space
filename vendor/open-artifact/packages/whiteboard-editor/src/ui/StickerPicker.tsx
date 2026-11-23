/**
 * The sticker picker: search, the upload cell (a picture from this
 * device), the face sticker (a vote with your avatar), recent stickers and
 * two packs, Icons and Emoji, each shown in themed sections (whiteboard-core's
 * `STICKER_CATEGORIES`). A typed emoji that is not in the catalog can be used
 * as is.
 *
 * A click arms the Sticker tool with a cell's sticker. Cells drag onto
 * the board, peeling off the panel as they go (`ui/sticker-drag.ts`); the
 * face sticker does not drag, and picked from the keyboard it is placed at
 * once (on the one selected item, else in the middle of the view). The
 * recent row keeps its order while the picker is open.
 */

import { ImagePlus, Search } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  FACE_STICKER_ART,
  ICON_STICKERS,
  STICKER_CATEGORIES,
  STICKER_EMOJI,
  iconStickerOf,
  normalizeStickerGlyph,
  stickerArtForEmoji,
  stickerLabel,
} from '@open-artifact/whiteboard-core';
import { cn } from '@open-artifact/ui';
import { canEditBoard } from '../services/actions.ts';
import { READ_ONLY_MESSAGE, refuse } from '../services/announce.ts';
import { viewCenter } from '../services/navigation.ts';
import { useRecentStickers } from '../state/recent-stickers.ts';
import { useTool, type StickerChoice } from '../state/tool.ts';
import { placeSticker } from '../tools/sticker.ts';
import { StickerGlyph } from './StickerGlyph.tsx';
import { Tip } from './chrome.tsx';
import { STICKER_ART_ATTRIBUTE, STICKER_DRAG_ATTRIBUTE, STICKER_GLYPH_ATTRIBUTE, useStickerDrag } from './sticker-drag.ts';

/** Places the viewer's face sticker (a vote) and puts the Sticker tool down. */
function placeFaceSticker(): void {
  if (!canEditBoard()) {
    refuse(READ_ONLY_MESSAGE);
    return;
  }
  placeSticker({ art: FACE_STICKER_ART }, viewCenter());
  useTool.getState().pick({ tool: 'select' });
}

/** The picker's packs. */
type StickerPack = 'icons' | 'emoji';

const PACK_LABELS: Record<StickerPack, string> = { icons: 'Icons', emoji: 'Emoji' };

/** One cell of the grid. */
interface Cell {
  key: string;
  choice: StickerChoice;
  title: string;
  /** Words a search matches. */
  find: string[];
}

function catalogCell(art: string): Cell {
  const glyph = STICKER_EMOJI[art];
  const title = stickerLabel({ art, glyph: glyph ?? '' });
  return { key: art, choice: { art }, title, find: [art.replace(/^icon-/, '').replaceAll('-', ' '), title, ...(glyph ? [glyph] : [])] };
}

function iconCell(key: string): Cell | undefined {
  const sticker = iconStickerOf(key);
  if (!sticker) return undefined;
  return { key: sticker.key, choice: { art: sticker.key }, title: sticker.label, find: [sticker.icon.replaceAll('-', ' '), sticker.label, sticker.glyph] };
}

const PACK_CELLS: Record<StickerPack, Cell[]> = {
  icons: ICON_STICKERS.map((sticker) => iconCell(sticker.key)!),
  emoji: Object.keys(STICKER_EMOJI).map(catalogCell),
};

/** One titled group of a pack. */
interface Section {
  id: string;
  label: string;
  cells: Cell[];
}

/** Each pack as its categories (searching shows one flat list instead). */
const PACK_SECTIONS: Record<StickerPack, Section[]> = {
  icons: STICKER_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    cells: category.icons.flatMap((icon) => iconCell(`icon-${icon}`) ?? []),
  })).filter((section) => section.cells.length > 0),
  emoji: STICKER_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    cells: category.emoji.filter((key) => Object.hasOwn(STICKER_EMOJI, key)).map(catalogCell),
  })).filter((section) => section.cells.length > 0),
};

/** Search rank: 0 for a word that starts with the query, 1 for a substring, -1 for no match. */
function matchRank(cell: Cell, query: string): number {
  let best = -1;
  for (const word of cell.find) {
    const text = word.toLowerCase();
    if (text === query || text.split(/\s+/).some((part) => part.startsWith(query))) return 0;
    if (text.includes(query)) best = 1;
  }
  return best;
}

let lastPack: StickerPack = 'icons';

/** Props of {@link StickerPicker}. */
export interface StickerPickerProps {
  /** A sticker was picked (by click or keyboard). */
  onPick(choice: StickerChoice): void;
  /** Opens the file picker for a picture; absent when uploads are off. */
  onUpload?: () => void;
  /** The viewer, for the face sticker; absent when the board does not know them. */
  me?: { id: string; name: string };
}

/** Columns of the sticker grid (arrow keys move by this much vertically). */
const COLUMNS = 7;

/** The sticker picker panel. */
export function StickerPicker({ onPick, onUpload, me }: StickerPickerProps) {
  const [query, setQuery] = useState('');
  const [pack, setPack] = useState<StickerPack>(lastPack);
  // Read once: the row keeps still while the picker is open.
  const [recentArts] = useState(() => useRecentStickers.getState().arts);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useStickerDrag(panelRef);
  const trimmed = query.trim().toLowerCase();

  const recent = useMemo(() => recentArts.map((art) => (art === FACE_STICKER_ART ? null : catalogCell(art))).filter((cell): cell is Cell => cell !== null), [recentArts]);

  const shown = useMemo(() => {
    if (trimmed === '') return PACK_CELLS[pack];
    return [...PACK_CELLS.icons, ...PACK_CELLS.emoji]
      .map((cell, index) => [matchRank(cell, trimmed), index, cell] as const)
      .filter(([rank]) => rank >= 0)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([, , cell]) => cell);
  }, [trimmed, pack]);

  // A typed emoji: offer it even when the catalog does not name it.
  const typedEmoji = useMemo(() => {
    const glyph = normalizeStickerGlyph(query);
    if (glyph === undefined) return undefined;
    const art = stickerArtForEmoji(glyph);
    return art !== undefined ? catalogCell(art) : { key: `glyph:${glyph}`, choice: { glyph }, title: glyph, find: [glyph] };
  }, [query]);

  const pick = (choice: StickerChoice, keyboard: boolean) => {
    if (drag.justDropped()) return;
    if (choice.art === FACE_STICKER_ART) {
      if (keyboard) placeFaceSticker();
      else onPick(choice);
      return;
    }
    if (choice.art !== undefined) useRecentStickers.getState().use(choice.art);
    onPick(choice);
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    const cells = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-sticker-cell]') ?? [])];
    const at = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    cells[Math.max(0, Math.min(cells.length - 1, at + delta))]?.focus();
  };

  const searching = trimmed !== '';
  const nothing = searching && shown.length === 0 && typedEmoji === undefined;

  return (
    <div ref={panelRef} className="flex w-[min(320px,calc(100vw-24px))] flex-col gap-2 p-0.5">
      <div className="flex items-center gap-1.5">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] bg-chrome-hover px-2 text-chrome-muted focus-within:ring-2 focus-within:ring-chrome-accent">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (gridRef.current) gridRef.current.scrollTop = 0;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault();
                event.stopPropagation();
                setQuery('');
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                gridRef.current?.querySelector<HTMLButtonElement>('[data-sticker-cell]')?.focus();
              }
            }}
            role="searchbox"
            placeholder="Search stickers"
            aria-label="Search stickers"
            maxLength={40}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-chrome-fg outline-none placeholder:text-chrome-muted"
          />
        </label>
        {searching ? null : (
          <div role="tablist" aria-label="Sticker packs" className="flex shrink-0 rounded-[8px] bg-chrome-hover p-0.5">
            {(Object.keys(PACK_LABELS) as StickerPack[]).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={pack === name}
                onClick={() => setPack((lastPack = name))}
                className={cn('h-7 rounded-[6px] px-2 text-[13px] text-chrome-muted outline-none focus-visible:ring-2 focus-visible:ring-chrome-accent', pack === name && 'bg-chrome text-chrome-fg shadow-chrome')}
              >
                {PACK_LABELS[name]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={gridRef} onKeyDown={onGridKeyDown} {...drag.handlers} className="max-h-[min(312px,calc(100vh-180px))] touch-pan-y overflow-y-auto overscroll-contain">
        {nothing ? <p role="status" className="px-2 py-1 text-[13px] text-chrome-muted">No matching stickers</p> : null}
        {!searching ? (
          <div className="grid grid-cols-7 gap-0.5 pb-1">
            {onUpload ? (
              <Tip label="Upload a picture" side="top">
                <button
                  type="button"
                  data-sticker-cell=""
                  aria-label="Upload a picture"
                  onClick={onUpload}
                  className="grid aspect-square place-items-center rounded-[8px] text-chrome-muted outline-none hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent"
                >
                  <ImagePlus className="size-5" aria-hidden="true" />
                </button>
              </Tip>
            ) : null}
            {me ? <StickerCell cell={{ key: FACE_STICKER_ART, choice: { art: FACE_STICKER_ART }, title: 'Vote with your face', find: [] }} me={me} onPick={pick} fixed /> : null}
            {recent.map((cell) => (
              <StickerCell key={`recent:${cell.key}`} cell={cell} onPick={pick} />
            ))}
          </div>
        ) : null}
        {searching ? (
          <div role="group" aria-label="Matching stickers" className="grid grid-cols-7 gap-0.5">
            {typedEmoji ? <StickerCell cell={typedEmoji} onPick={pick} /> : null}
            {shown.map((cell) => (typedEmoji?.key === cell.key ? null : <StickerCell key={cell.key} cell={cell} onPick={pick} />))}
          </div>
        ) : (
          PACK_SECTIONS[pack].map((section) => (
            <div key={section.id} role="group" aria-label={`${PACK_LABELS[pack]}: ${section.label}`}>
              <p className="sticky top-0 z-[1] bg-chrome px-1 pb-0.5 pt-1.5 text-[12px] text-chrome-muted">{section.label}</p>
              <div className="grid grid-cols-7 gap-0.5">
                {section.cells.map((cell) => (
                  <StickerCell key={cell.key} cell={cell} onPick={pick} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Props of {@link StickerCell}. */
interface StickerCellProps {
  cell: Cell;
  /** For the face sticker: whose face. */
  me?: { id: string; name: string };
  /** The cell was clicked (`keyboard`: activated from the keyboard). */
  onPick(choice: StickerChoice, keyboard: boolean): void;
  /** The cell does not drag (the face sticker). */
  fixed?: boolean;
}

/** One sticker button: a click picks it; dragged out, it goes on the board (see `useStickerDrag`). */
function StickerCell({ cell, me, onPick, fixed = false }: StickerCellProps) {
  const dragData = fixed
    ? {}
    : {
        [STICKER_DRAG_ATTRIBUTE]: '',
        ...(cell.choice.art !== undefined ? { [STICKER_ART_ATTRIBUTE]: cell.choice.art } : {}),
        ...(cell.choice.glyph !== undefined ? { [STICKER_GLYPH_ATTRIBUTE]: cell.choice.glyph } : {}),
      };
  return (
    <Tip label={cell.title} side="top">
      <button
        type="button"
        data-sticker-cell=""
        {...dragData}
        aria-label={`Pick sticker: ${cell.title}`}
        onClick={(event: MouseEvent<HTMLButtonElement>) => onPick(cell.choice, event.detail === 0)}
        className="grid aspect-square place-items-center rounded-[8px] outline-none transition-transform hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent active:scale-95"
      >
        <StickerGlyph art={cell.choice.art} glyph={cell.choice.glyph} who={me} size={26} animate="hover" />
      </button>
    </Tip>
  );
}
