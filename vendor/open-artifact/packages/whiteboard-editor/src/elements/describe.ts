/**
 * What screen readers hear about board elements: a short description of
 * each element ("Yellow sticky note, “Ship it”", "Arrow from “A” to “B”,
 * “depends on”", "Section, “Q3”, 4 items"), the attributes of a board item
 * in the list of board items, and the labels of edit actions.
 */

import {
  NOTE_COLORS,
  SHAPE_KIND_LABELS,
  TEXT_SIZE_STYLES,
  arrowDirectedEnds,
  arrowEndIds,
  arrowHeads,
  capitalizeFirstLetter,
  describeTimer,
  elementLayoutBox,
  elementPlainText,
  elementsWithinBox,
  htmlDocumentTitle,
  isTimerRunning,
  linkKindLabel,
  linkTitle,
  showsTextPlaceholder,
  stickerLabel,
  tableColumnIds,
  tableRowIds,
  textProfileForElement,
  textWithListPrefixes,
  timerRemainingMs,
  type ArrowEnd,
  type BoardElement,
  type ElementId,
  type ElementMeasures,
  type ElementsById,
} from '@open-artifact/whiteboard-core';

/** Name of the list of board items. */
export const BOARD_ITEMS_LIST_LABEL = 'Board items';

/** Prefix of the action that comments on an element. */
export const COMMENT_ON_PREFIX = 'Comment on ';

/** Most characters of an element's text quoted in a description. */
export const SPOKEN_QUOTE_MAX = 40;

/** "N item(s)". */
export function formatItemCount(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/** Name of the whole board region: "Whiteboard, N items". */
export function whiteboardRegionLabel(count: number): string {
  return `Whiteboard, ${formatItemCount(count)}`;
}

/** Text as one spoken line: list markers kept, marks dropped, whitespace collapsed. */
export function flattenSpokenText(text: string, element?: BoardElement): string {
  const profile = element ? textProfileForElement(element) : undefined;
  return textWithListPrefixes(text, profile).replace(/\s+/g, ' ').trim();
}

/** Text quoted for speech (“…”, at most {@link SPOKEN_QUOTE_MAX} characters); `undefined` when empty. */
export function quoteSpokenText(text: string, element?: BoardElement): string | undefined {
  const flat = flattenSpokenText(text, element);
  if (flat === '') return undefined;
  const chars = [...flat];
  const shown = chars.length > SPOKEN_QUOTE_MAX ? `${chars.slice(0, SPOKEN_QUOTE_MAX - 3).join('')}…` : flat;
  return `“${shown}”`;
}

/** Whether a fill is one of the named palette colors (spoken by name). */
export function isNamedPaletteColor(color: string): color is (typeof NOTE_COLORS)[number] {
  return (NOTE_COLORS as readonly string[]).includes(color);
}

/** The spoken kind of an element ("yellow sticky note", "large text", "video"…), lowercase. */
export function describeElementKind(element: BoardElement): string {
  const color = 'color' in element && typeof element.color === 'string' && isNamedPaletteColor(element.color) ? `${element.color} ` : '';
  switch (element.type) {
    case 'note':
      return `${color}sticky note`;
    case 'shape':
      return `${color}${SHAPE_KIND_LABELS[element.kind].toLowerCase()}`;
    case 'container':
      return 'section';
    case 'text':
      return element.size === 'body' ? 'text' : `${TEXT_SIZE_STYLES[element.size].label.toLowerCase()} text`;
    case 'sticker':
      return element.art === 'face' ? 'face sticker' : `sticker ${stickerLabel(element)}`;
    case 'image':
      return element.video !== undefined ? 'video' : element.href !== undefined ? 'linked image' : 'image';
    case 'stroke':
      return 'sketch';
    case 'html':
      return 'web embed';
    case 'timer':
      return 'shared timer';
    case 'link':
      return `${linkKindLabel(element).toLowerCase()} link`;
    case 'table':
      return 'table';
    case 'arrow':
      return 'arrow';
  }
}

/** One end of an arrow, spoken: the quoted text or kind of what it points at. */
export function describeArrowEnd(end: ArrowEnd, byId: ElementsById): string {
  if (typeof end !== 'string') return 'a spot on the board';
  const target = byId.get(end);
  if (!target || target.type === 'arrow') return 'unknown';
  const text = 'text' in target && typeof target.text === 'string' ? quoteSpokenText(target.text, target) : undefined;
  return text ?? describeElementKind(target);
}

/** What an arrow is called from its end styles ("two-way arrow", "line with a circle at its end"…). */
function arrowKind(heads: readonly [string, string]): string {
  const arrows = heads.filter((head) => head === 'arrow').length;
  const circles = heads.filter((head) => head === 'circle').length;
  if (arrows === 2) return 'two-way arrow';
  if (arrows === 1) return circles > 0 ? 'arrow with a circle at its tail' : 'arrow';
  if (circles === 2) return 'line with circles at both ends';
  if (circles === 1) return `line with a circle at its ${heads[0] === 'circle' ? 'start' : 'end'}`;
  return 'line';
}

/** The spoken description of an element. */
export function describeElement(element: BoardElement, byId: ElementsById, measures?: ElementMeasures): string {
  const kind = capitalizeFirstLetter(describeElementKind(element));
  switch (element.type) {
    case 'note':
    case 'shape':
    case 'text': {
      if (showsTextPlaceholder(element)) return `${kind}, empty, hint ${quoteSpokenText(element.placeholder) ?? ''}`;
      const quote = quoteSpokenText(element.text, element);
      return quote ? `${kind}, ${quote}` : kind;
    }
    case 'container': {
      const box = elementLayoutBox(element, measures);
      const count = box ? elementsWithinBox(box, [...byId.values()], measures, element.id).length : 0;
      const title = quoteSpokenText(element.text, element);
      return `Section${title ? `, ${title}` : ''}, ${formatItemCount(count)}`;
    }
    case 'arrow': {
      const name = `${element.dash ? 'dashed ' : ''}${arrowKind(arrowHeads(element))}`;
      const ends = arrowEndIds(element).length === 0 ? ', not attached' : (() => {
        const { from, to } = arrowDirectedEnds(element);
        return ` from ${describeArrowEnd(from, byId)} to ${describeArrowEnd(to, byId)}`;
      })();
      const label = element.label ? quoteSpokenText(element.label) : undefined;
      return `${capitalizeFirstLetter(name)}${ends}${label ? `, ${label}` : ''}`;
    }
    case 'timer': {
      const now = Date.now();
      return describeTimer(timerRemainingMs(element, now), isTimerRunning(element, now));
    }
    case 'html': {
      const title = htmlDocumentTitle(element.html);
      return title ? `${kind}, ${quoteSpokenText(title) ?? ''}` : kind;
    }
    case 'link':
      return `${kind}, ${quoteSpokenText(linkTitle(element)) ?? ''}`.replace(/, $/, '');
    case 'table': {
      const rows = tableRowIds(element).length;
      const cols = tableColumnIds(element).length;
      const text = quoteSpokenText(elementPlainText(element));
      return `Table, ${rows} ${rows === 1 ? 'row' : 'rows'} by ${cols} ${cols === 1 ? 'column' : 'columns'}${text ? `, ${text}` : ''}`;
    }
    case 'sticker':
    case 'image':
    case 'stroke':
      return kind;
  }
}

/** Whether a placeholder is longer than its spoken quote (so the whole hint is given as a description). */
export function placeholderNeedsDescription(placeholder: string): boolean {
  return [...placeholder.replace(/\s+/g, ' ').trim()].length > SPOKEN_QUOTE_MAX;
}

/** The DOM id of the node holding a text's whole placeholder. */
export function placeholderHintId(id: ElementId): string {
  return `wb-${id}-hint`;
}

/** The label of the action that edits an element's text. */
export function editTextActionLabel(element: Pick<BoardElement, 'type'>): string {
  switch (element.type) {
    case 'note':
      return 'Edit sticky note text';
    case 'shape':
      return 'Edit shape text';
    case 'container':
      return 'Edit section title';
    case 'arrow':
      return 'Edit arrow label';
    case 'html':
      return 'Edit embed HTML';
    default:
      return 'Edit text';
  }
}

/** Attributes of one item in the list of board items. */
export interface BoardListItemProps {
  role: 'listitem';
  'aria-label': string;
  'aria-posinset'?: number;
  'aria-setsize'?: number;
  'aria-describedby'?: string;
}

/** The list-item attributes of an element: its label, with "pos of size" when known. */
export function boardListItemProps(label: string, pos?: number, size?: number, describedBy?: string): BoardListItemProps {
  const placed = pos !== undefined && size !== undefined && size > 0;
  return {
    role: 'listitem',
    'aria-label': placed ? `${label}, ${pos} of ${size}` : label,
    ...(placed ? { 'aria-posinset': pos, 'aria-setsize': size } : {}),
    ...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {}),
  };
}
