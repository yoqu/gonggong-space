import type { PlayerBox } from '../stores/ui.ts';

export interface Size {
  width: number;
  height: number;
}

/** The film's picture letterboxed in the area: as large as fits, centred, in whole pixels. */
export function fitBox(area: Size, film: Size): PlayerBox {
  if (!(area.width > 0 && area.height > 0 && film.width > 0 && film.height > 0)) return { left: 0, top: 0, width: Math.max(0, area.width), height: Math.max(0, area.height) };
  const scale = Math.min(area.width / film.width, area.height / film.height);
  const width = Math.round(film.width * scale);
  const height = Math.round(film.height * scale);
  return { left: Math.round((area.width - width) / 2), top: Math.round((area.height - height) / 2), width, height };
}

/** A point in the area as a fraction of the picture (0…1 each way), or `null` outside it. */
export function pictureFraction(box: PlayerBox, x: number, y: number): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const fx = (x - box.left) / box.width;
  const fy = (y - box.top) / box.height;
  return fx < 0 || fx > 1 || fy < 0 || fy > 1 ? null : { x: fx, y: fy };
}
