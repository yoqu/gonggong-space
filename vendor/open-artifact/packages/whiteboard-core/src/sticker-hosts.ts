/**
 * Sticker hosts on the stored board: a sticker records the host it sits on
 * and where both were (`on`: `[hostId, hostX, hostY, stickerX, stickerY,
 * offX?, offY?]`). When someone else moves the host and the sticker was not
 * moved, the sticker follows on load ({@link followStickerHosts}); after a
 * local edit the record is refreshed ({@link rebindStickersToHosts}).
 *
 * A followed sticker is a derived element: it remembers its stored twin in
 * {@link persistedElementByDerived} so the shifted position is not written
 * back unless the sticker is edited.
 */

import { canHostSticker, findStickerHost, moveStickersWithHosts } from './attachments.ts';
import { normalizeElementOrKeep, persistedElementByDerived } from './derived.ts';
import { elementLayoutBox, type ElementMeasures } from './geometry.ts';
import { COORDINATE_LIMIT, elementTurn, type BoardElement, type ElementId, type StickerElement, type StickerOn } from './schema.ts';

let stickerRebindSuspended = false;

/** The sticker without a recorded host. */
export function withoutStickerHost(sticker: StickerElement): StickerElement {
  const { on: _on, ...rest } = sticker;
  return rest;
}

/** Clamps a coordinate to the board's extent. */
export function clampToBoardExtent(value: number): number {
  return Math.min(COORDINATE_LIMIT, Math.max(-COORDINATE_LIMIT, value));
}

/** True when the declared width and height (where both have them) are equal. */
export function sameDeclaredSize(a: BoardElement, b: BoardElement): boolean {
  return (!('w' in a) || !('w' in b) || a.w === b.w) && (!('h' in a) || !('h' in b) || a.h === b.h);
}

/** True when two offsets match within a tenth of a unit. */
export function nearlySameOffset(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.100001;
}

/** True when a host's size (declared, measured, or text wrap) changed. */
export function hostShapeChanged(before: BoardElement, after: BoardElement, measures?: ElementMeasures): boolean {
  const beforeBox = elementLayoutBox(before, measures);
  const afterBox = elementLayoutBox(after, measures);
  return (
    !sameDeclaredSize(before, after) ||
    (before.type === 'text' && after.type === 'text' && before.wrap !== after.wrap) ||
    beforeBox?.w !== afterBox?.w ||
    beforeBox?.h !== afterBox?.h
  );
}

/**
 * Stickers follow hosts that moved since they were recorded. A sticker that
 * did not move shifts with its host (unless the recorded offset says it was
 * already shifted); a sticker that moved looks for a new host. The same
 * array comes back when nothing follows.
 */
export function followStickerHosts(elements: readonly BoardElement[], measures?: ElementMeasures): readonly BoardElement[] {
  if (!elements.some((element) => element.type === 'sticker' && element.on !== undefined)) return elements;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const followed = elements.map((element): BoardElement => {
    if (element.type !== 'sticker' || element.on === undefined) return element;
    const [hostId, hostX, hostY, stickerX, stickerY, offsetX, offsetY] = element.on;
    const host = byId.get(hostId);
    if (host === undefined || !canHostSticker(host)) return element;
    const stickerUnmoved = element.x === stickerX && element.y === stickerY;
    const hostUnmoved = host.x === hostX && host.y === hostY;
    if (stickerUnmoved && hostUnmoved) return element;
    const keptOffset =
      offsetX !== undefined && offsetY !== undefined && Math.abs(host.x - hostX - offsetX) < 0.5 && Math.abs(host.y - hostY - offsetY) < 0.5;
    const [x, y] =
      stickerUnmoved && !keptOffset
        ? [clampToBoardExtent(element.x + host.x - hostX), clampToBoardExtent(element.y + host.y - hostY)]
        : [element.x, element.y];
    const nextHost = stickerUnmoved ? host : findStickerHost(element, elements, measures, '');
    if (nextHost === undefined) return withoutStickerHost(element);
    const offset: [number, number] | [] =
      hostUnmoved && nextHost === host ? [clampToBoardExtent(element.x - stickerX), clampToBoardExtent(element.y - stickerY)] : [];
    const next: StickerElement = { ...element, x, y, on: [nextHost.id, nextHost.x, nextHost.y, x, y, ...offset] as StickerOn };
    persistedElementByDerived.set(next, { ...element });
    return next;
  });
  return followed.some((element, index) => element !== elements[index]) ? followed : elements;
}

/** Copies followed stickers so they lose their derived mark (they will be stored as they are). */
export function unmarkFollowedStickers(elements: readonly BoardElement[]): readonly BoardElement[] {
  return elements.some((element) => element.type === 'sticker' && persistedElementByDerived.has(element))
    ? elements.map((element) => (element.type === 'sticker' && persistedElementByDerived.has(element) ? { ...element } : element))
    : elements;
}

/** Runs `run` without moving stickers onto resized hosts (for edits that set stickers themselves). */
export function withStickerRebindSuspended(run: () => void): void {
  const previous = stickerRebindSuspended;
  stickerRebindSuspended = true;
  try {
    run();
  } finally {
    stickerRebindSuspended = previous;
  }
}

/**
 * Refreshes stickers' host records after an edit (`before` → `after`):
 * - a sticker left alone whose host was resized or moved by this edit
 *   moves with it (scaled to the new size);
 * - every sticker that moved, or whose host changed, records its current
 *   host (or drops the record when it sits on nothing).
 * The same array comes back when nothing changes.
 */
export function rebindStickersToHosts(before: readonly BoardElement[], after: readonly BoardElement[], measures?: ElementMeasures): readonly BoardElement[] {
  if (!after.some((element) => element.type === 'sticker')) return after;
  const beforeById = new Map(before.map((element) => [element.id, element]));
  const afterById = new Map(after.map((element) => [element.id, element]));
  const rehosts = new Map(
    (stickerRebindSuspended ? [] : after).flatMap((element): Array<[ElementId, ElementId]> => {
      const hostId = element.type === 'sticker' && beforeById.get(element.id) === element ? element.on?.[0] : undefined;
      if (hostId === undefined) return [];
      const hostBefore = beforeById.get(hostId);
      const hostAfter = afterById.get(hostId);
      if (hostBefore === undefined || hostAfter === undefined || hostBefore === hostAfter || !canHostSticker(hostBefore) || !canHostSticker(hostAfter)) return [];
      if (elementTurn(hostAfter) !== 0 && elementTurn(hostBefore) === elementTurn(hostAfter) && (hostAfter.type === 'note' || hostAfter.type === 'text')) return [];
      const reshaped = hostShapeChanged(hostBefore, hostAfter, measures);
      if ((!reshaped && hostBefore.x === hostAfter.x && hostBefore.y === hostAfter.y) || findStickerHost(element, before, measures)?.id !== hostId) return [];
      return !reshaped || (!(hostAfter.type === 'text' && hostAfter.wrap === undefined) && findStickerHost(element, after, measures)?.id !== hostId)
        ? [[element.id, hostId]]
        : [];
    }),
  );
  const rehosted: readonly BoardElement[] =
    rehosts.size === 0
      ? after
      : moveStickersWithHosts(before, [...after], measures, { hosts: rehosts, only: true, stretch: true }).map((element) =>
          element.type === 'sticker' && rehosts.has(element.id) ? { ...element, x: clampToBoardExtent(element.x), y: clampToBoardExtent(element.y) } : element,
        );
  const rebound = rehosted.map((element): BoardElement => {
    if (element.type !== 'sticker') return element;
    const previous = beforeById.get(element.id);
    const hostId =
      element.on?.[0] ?? (previous !== element && previous?.type === 'sticker' ? findStickerHost(previous, before, measures)?.id : undefined);
    const hostCandidate = hostId === undefined ? undefined : afterById.get(hostId);
    const host = hostCandidate !== undefined && canHostSticker(hostCandidate) ? hostCandidate : undefined;
    const hostBefore = host === undefined ? undefined : beforeById.get(host.id);
    if (previous === element && (host === undefined || hostBefore === host)) return element;
    const movedWithHost =
      host !== undefined &&
      previous?.type === 'sticker' &&
      hostBefore !== undefined &&
      canHostSticker(hostBefore) &&
      sameDeclaredSize(hostBefore, host) &&
      nearlySameOffset(element.x - previous.x, host.x - hostBefore.x) &&
      nearlySameOffset(element.y - previous.y, host.y - hostBefore.y);
    const keepsRecordedHost =
      previous === undefined ||
      (previous.type === 'sticker' && previous.x === element.x && previous.y === element.y) ||
      (element.x === element.on?.[3] && element.y === element.on[4]) ||
      (hostBefore !== undefined && host !== undefined && (hostShapeChanged(hostBefore, host, measures) || elementTurn(hostBefore) !== elementTurn(host)));
    const nextHost = movedWithHost ? host : findStickerHost(element, rehosted, measures, keepsRecordedHost ? hostId : '');
    const record: StickerOn | undefined = nextHost === undefined ? undefined : [nextHost.id, nextHost.x, nextHost.y, element.x, element.y];
    const sameRecord = element.on !== undefined && String(record) === String(element.on.slice(0, 5));
    if (sameRecord && !persistedElementByDerived.has(element)) return element;
    return record === undefined ? withoutStickerHost(element) : normalizeElementOrKeep({ ...element, on: sameRecord ? element.on : record });
  });
  return rebound.some((element, index) => element !== rehosted[index]) ? rebound : rehosted;
}
