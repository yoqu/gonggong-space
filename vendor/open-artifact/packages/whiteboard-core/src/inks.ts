/**
 * The board's custom ink colors: hex colors people added to the palette,
 * shared through the board's `inks` record. Ordinary edits never change them;
 * only {@link InkStore.setInks} does, so concurrent palette changes and
 * element edits do not undo each other.
 */

import { HEX_COLOR_PATTERN, MAX_BOARD_INKS, type BoardContent, type BoardInk, type HexColor } from './schema.ts';

/** True for a custom (hex) color rather than a named palette color. */
export function isCustomInkColor(color: string): color is HexColor {
  return HEX_COLOR_PATTERN.test(color);
}

/** The inks without `color`. */
export function withoutInk(inks: readonly BoardInk[], color: string): BoardInk[] {
  return inks.filter((ink) => ink.color !== color);
}

/** The content with other inks (`undefined` drops the field). */
export function withInks(content: BoardContent, inks: readonly BoardInk[] | undefined): BoardContent {
  const { inks: _previous, ...rest } = content;
  return inks === undefined ? rest : { ...rest, inks: [...inks] };
}

/**
 * The inks with `color` added (lower-cased) as the newest, keeping at most
 * {@link MAX_BOARD_INKS} (the oldest go first). An ink already there keeps
 * its place. Returns `inks` itself when nothing changes or the color is not
 * a hex color.
 */
export function addInk(inks: readonly BoardInk[], color: string, at: number = Date.now()): readonly BoardInk[] {
  if (!isCustomInkColor(color)) return inks;
  const hex = color.toLowerCase() as HexColor;
  if (inks.some((ink) => ink.color.toLowerCase() === hex)) return inks;
  return [...inks, { color: hex, at }].slice(-MAX_BOARD_INKS);
}

/** A document whose content can be read and replaced. */
export interface ContentStore<R = unknown> {
  content(): BoardContent;
  setContent(content: BoardContent): R;
  updateContent?(updater: (content: BoardContent) => BoardContent): R;
}

/** What {@link withInkStore} adds. */
export interface InkStore<R = unknown> {
  /** Replaces the board's inks (content otherwise unchanged). */
  setInks(inks: readonly BoardInk[] | undefined): R;
}

/**
 * Makes a content store keep the current inks on every content write, and
 * adds {@link InkStore.setInks} as the one way to change them. Changes the
 * store in place and returns it; wrapping twice is a no-op.
 */
export function withInkStore<R, S extends ContentStore<R>>(store: S): S & InkStore<R> {
  const wrapped = store as S & Partial<InkStore<R>>;
  if (wrapped.setInks !== undefined) return wrapped as S & InkStore<R>;
  const setContent = store.setContent.bind(store);
  const updateContent = store.updateContent?.bind(store);
  wrapped.setContent = (content) => setContent(content === store.content() ? content : withInks(content, store.content().inks));
  if (updateContent !== undefined) {
    wrapped.updateContent = (updater) =>
      updateContent((current) => {
        const next = updater(current);
        return next === current ? next : withInks(next, current.inks);
      });
  }
  wrapped.setInks = (inks) => setContent(withInks(store.content(), inks));
  return wrapped as S & InkStore<R>;
}
