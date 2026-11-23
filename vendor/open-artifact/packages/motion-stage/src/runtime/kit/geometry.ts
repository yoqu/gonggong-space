import { stageElement, stageSize } from '../stage-size.ts';
import type { CameraState } from './camera.ts';
import type { Point } from './paper.ts';

export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const stageBox = (): DOMRect => stageElement()?.getBoundingClientRect() ?? new DOMRect();

/** A node's box in stage px, as seen: the frame's fit undone, a camera's zoom kept. */
export function srect(node: Element | Range): StageRect {
  const box = node.getBoundingClientRect();
  const stage = stageBox();
  const k = stageSize.fit;
  return { x: (box.left - stage.left) / k, y: (box.top - stage.top) / k, w: box.width / k, h: box.height / k };
}

export const center =
  (node: Element | Range, dx: number = 0, dy: number = 0): (() => Point) =>
  (): Point => {
    const box = srect(node);
    return [box.x + box.w / 2 + dx, box.y + box.h / 2 + dy];
  };

const unzoomed = (box: StageRect, camera: { state: CameraState }): StageRect => {
  const c = camera.state;
  return { x: (box.x - c.tx) / c.z, y: (box.y - c.ty) / c.z, w: box.w / c.z, h: box.h / c.z };
};

/** A node's box in a camera's own scene space, where marks and a cursor inside the camera are placed. */
export const camrect = (node: Element | Range, camera: { state: CameraState }): StageRect => unzoomed(srect(node), camera);

/** The stage box of the last line of `phrase` inside `el`'s text, or null where it is not shown yet. */
export function phraseRect(el: Element | null, phrase: string): (StageRect & { lines: number }) | null {
  if (!el) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node instanceof Text ? node.data : '';
    const index = text.indexOf(phrase);
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + phrase.length);
    const rects = [...range.getClientRects()];
    const last = rects[rects.length - 1];
    if (!last) return null;
    const stage = stageBox();
    const k = stageSize.fit;
    return { x: (last.left - stage.left) / k, y: (last.top - stage.top) / k, w: last.width / k, h: last.height / k, lines: rects.length };
  }
  return null;
}

export function phraseCamRect(el: Element | null, phrase: string, camera: { state: CameraState }): StageRect | null {
  const box = phraseRect(el, phrase);
  return box ? unzoomed(box, camera) : null;
}
