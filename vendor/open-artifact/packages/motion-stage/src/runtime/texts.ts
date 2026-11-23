import type { StageText } from '../protocol.ts';
import { filmTime, realNow } from './determinism.ts';
import { srect } from './kit/geometry.ts';
import { say } from './port.ts';
import { inOwnColors } from './snapshot/serialize.ts';
import { lineFor } from './retouch/retouch.ts';
import type { LineMemo } from './retouch/seat.ts';
import { fitIfResized, laidOut, stageParts } from './stage.ts';
import { stretchOf } from './stretch.ts';

/*
 * While the page watches, it is sent the stage's text nodes in document order: at 'watch', after each paused frame,
 * after a turn that drew moments of its own, and after a resize. Each time, only while the stage shows the moment the
 * page asked for, and once the frame is laid out. Hidden nodes are sent too: without them, nodes that are apart would
 * sit side by side, and a line of the script could be found across the gap.
 */
const MOST_NODES = 2000;
const MOST_CHARS = 60000;
const LONGEST_NODE = 301;
/** Hit testing slows as the stage fills: after this long in all, whatever is not hidden counts as seen. */
const HIT_TEST_MS = 40;

/** A wait for the resizing to stop, or for a layout, looks again after this long. */
const RETELL_MS = 100;
/** A frame that is still not laid out after this many looks has its words told as they are. */
const MOST_LOOKS = 30;

const watch = { on: false, places: false, resized: false, retelling: false };
/** Whether the stage shows the moment the page asked for; set at startup (render.ts knows). */
let showsAsked: () => boolean = () => true;

export function setTextsGuard(guard: () => boolean): void {
  showsAsked = guard;
}

/** The words go with the next report: the one at 'watch' itself is the caller's to make. */
export function setWatch(on: boolean, places: boolean): void {
  watch.on = on;
  watch.places = on && places;
}

/** Sends the words; a frame without a layout yet has no places to tell, so they wait for it (see {@link retell}). */
export function tellTexts(): void {
  const stage = stageParts()?.stage;
  if (!watch.on || !stage) return;
  // Seen is a hit test, so the stage must fit the frame, which has its new size before it hears 'resize'.
  fitIfResized();
  if (!laidOut()) {
    retell();
    return;
  }
  sendTexts(stage);
}

function sendTexts(stage: HTMLElement): void {
  const nodes = watch.places
    ? inOwnColors(() => {
        // The styles are worked out now, not on the time textNodes allows for hit tests.
        void getComputedStyle(stage).display;
        return textNodes(stage, true);
      })
    : textNodes(stage, false);
  say({ type: 'texts', nodes });
}

/**
 * One report when the resizing stops and the frame is laid out, not one for each resize: a report's hit tests are
 * slow. Timers, not animation frames: a frame that is hidden gets none.
 */
export function retell(): void {
  watch.resized = true;
  if (watch.retelling || !watch.on) return;
  watch.retelling = true;
  let looks = 0;
  const rest = (): void => {
    looks += 1;
    if (watch.resized || (!laidOut() && looks < MOST_LOOKS)) {
      watch.resized = false;
      setTimeout(rest, RETELL_MS);
      return;
    }
    watch.retelling = false;
    const stage = stageParts()?.stage;
    if (watch.on && stage && showsAsked()) {
      fitIfResized();
      sendTexts(stage);
    }
  };
  setTimeout(rest, RETELL_MS);
}

function alphaOf(colour: string): number {
  if (/^rgba\(/.test(colour)) return parseFloat(colour.split(',')[3] ?? '1');
  if (colour.indexOf('/') > 0) return parseFloat(colour.split('/')[1] ?? '1');
  return 1;
}

/** It hides what lies under it: a picture, or an opaque background, under no faded holder. */
export function paintsOver(element: Element, stage: HTMLElement, memo: Map<Element, boolean>): boolean {
  const known = memo.get(element);
  if (known !== undefined) return known;
  const style = getComputedStyle(element);
  let solid = /^(IMG|VIDEO|CANVAS)$/.test(element.tagName) || style.backgroundImage.indexOf('url(') >= 0 || alphaOf(style.backgroundColor) > 0.9;
  for (let up: Element | null = element; solid && up && up !== stage; up = up.parentElement) if (parseFloat(getComputedStyle(up).opacity) < 0.9) solid = false;
  memo.set(element, solid);
  return solid;
}

/** The point lies outside a box that clips the element. Any clip-path counts as clipping it, whatever its shape. */
function clippedAt(element: Element, stage: HTMLElement, x: number, y: number): boolean {
  for (let up: Element | null = element; up && up !== stage.parentElement; up = up.parentElement) {
    const style = getComputedStyle(up);
    if (style.clipPath !== 'none') return true;
    if (up === element || (style.overflowX === 'visible' && style.overflowY === 'visible')) continue;
    const box = up.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return true;
  }
  return false;
}

/**
 * Nothing opaque lies over the line: tried at its middle, then near its ends, where long words may run under a
 * neighbour. `drawn`: a part of an inline svg, whose thin ink the points can miss; a hit on its own svg counts.
 */
export function seenAt(element: Element, line: DOMRect, stage: HTMLElement, memo: Map<Element, boolean>, drawn: boolean = false): boolean {
  // Hit testing skips it, so it counts as seen.
  if (getComputedStyle(element).pointerEvents === 'none') return true;
  const box = stage.getBoundingClientRect();
  const left = Math.max(line.left, box.left);
  const right = Math.min(line.right, box.right);
  const y = (Math.max(line.top, box.top) + Math.min(line.bottom, box.bottom)) / 2;
  if (!(right > left)) return false;
  return [0.5, 0.1, 0.9].some((share) => {
    const x = left + (right - left) * share;
    for (const hit of document.elementsFromPoint(x, y)) {
      if (hit === element || element.contains(hit)) return true;
      if (hit.contains(element)) {
        const svg = element instanceof SVGElement ? element.ownerSVGElement : null;
        return (drawn && !!svg && svg.contains(hit)) || !clippedAt(element, stage, x, y);
      }
      if (paintsOver(hit, stage, memo)) return false;
    }
    return false;
  });
}

const checksVisibility = (element: Element): boolean =>
  typeof element.checkVisibility !== 'function' || element.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true });

/**
 * Measured in the film's own pixels: on a small screen the whole picture may be a few pixels wide. places: each node
 * is told the line of words it is part of, as a change by hand to its look would name it; not in a scene that is not
 * final, where nothing of a person's is laid. The time this takes is not counted toward the time for hit tests.
 */
export function textNodes(stage: HTMLElement, places: boolean): StageText[] {
  const out: StageText[] = [];
  let chars = 0;
  let began = realNow();
  let within = places ? stretchOf(filmTime()).name : null;
  const lines = new Map<Element, LineMemo>();
  const place = (node: Text): string | null => {
    const p0 = realNow();
    let at: string | null = null;
    try {
      at = lineFor(node, lines);
    } catch {
      within = null;
    }
    began += realNow() - p0;
    return at;
  };
  const memo = new Map<Element, boolean>();
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node && out.length < MOST_NODES && chars < MOST_CHARS; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    let holder = node.parentElement;
    // A caption is skipped, the stage's or one the cut draws with that class: its words are spoken.
    if (!holder || !/\S/.test(node.data) || holder.closest('style,script,.film-caption')) continue;
    // display: contents has no box of its own to hide or to hit.
    while (holder && holder !== stage && getComputedStyle(holder).display === 'contents') holder = holder.parentElement;
    if (!holder) continue;
    const item: StageText = { text: node.data.slice(0, LONGEST_NODE) };
    chars += item.text.length;
    out.push(item);
    range.selectNodeContents(node);
    const bounds = range.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0)) continue;
    const rect = srect(range);
    const line = range.getClientRects()[0];
    if (rect.w < 1 || rect.h < 1 || !line) continue;
    item.x = rect.x;
    item.y = rect.y;
    item.w = rect.w;
    item.h = rect.h;
    item.line = (rect.h * line.height) / bounds.height;
    if (within !== null) {
      const at = place(node);
      if (at !== null) item.id = within + ':' + at;
    }
    const spent = realNow() - began;
    item.seen = checksVisibility(holder) && (spent > HIT_TEST_MS || seenAt(holder, line, stage, memo));
  }
  return out;
}
