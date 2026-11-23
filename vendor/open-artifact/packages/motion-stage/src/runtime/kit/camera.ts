import { eio, lerp, seg, type Ease } from './math.ts';
import { stageSize } from '../stage-size.ts';

export interface CameraKey {
  t: number;
  cx: number;
  cy: number;
  z: number;
  ease?: Ease;
  /** A hard cut at `t`: the key before holds right up to it. */
  cut?: boolean;
  /** When the ease toward this key begins; by default after the key before's `hold`. */
  from?: number;
  hold?: number;
  /** [dx/s, dy/s, dlogz/s]: a slow creep while this key holds, carried into the next ease. */
  drift?: [number, number, number?];
}

export interface CameraView {
  cx: number;
  cy: number;
  z: number;
}

export interface CameraState extends CameraView {
  tx: number;
  ty: number;
}

export interface CameraExtra {
  x?: number;
  y?: number;
  z?: number;
  rot?: number;
}

/** Wraps a layer of a scene: (cx, cy) is the point shown at the stage's centre, z the zoom. */
export class Camera {
  el: HTMLElement;
  keys: CameraKey[];
  state: CameraState;

  constructor(el: HTMLElement) {
    this.el = el;
    this.keys = [{ t: 0, cx: stageSize.width / 2, cy: stageSize.height / 2, z: 1 }];
    this.state = { tx: 0, ty: 0, z: 1, cx: 960, cy: 540 };
    el.style.transformOrigin = '0 0';
  }

  set(keys: CameraKey[]): this {
    this.keys = keys.slice().sort((a, b) => a.t - b.t);
    return this;
  }

  at(t: number): CameraView {
    const keys = this.keys;
    let index = 0;
    for (let k = 0; k < keys.length; k++) if ((keys[k]?.t ?? Infinity) <= t) index = k;
    const a = keys[index];
    if (!a) return { cx: stageSize.width / 2, cy: stageSize.height / 2, z: 1 };
    const b = keys[index + 1] ?? null;
    const easeFrom = b ? (b.cut ? b.t : b.from !== undefined ? b.from : a.t + (a.hold ?? 0)) : Infinity;
    const held = Math.max(0, Math.min(t, easeFrom) - a.t);
    let cx = a.cx;
    let cy = a.cy;
    let z = a.z;
    if (a.drift) {
      cx += a.drift[0] * held;
      cy += a.drift[1] * held;
      z *= Math.exp((a.drift[2] ?? 0) * held);
    }
    if (b && !b.cut && t > easeFrom) {
      const f = (b.ease ?? eio)(seg(t, easeFrom, b.t));
      z = Math.exp(lerp(Math.log(z), Math.log(b.z), f));
      cx = lerp(cx, b.cx, f);
      cy = lerp(cy, b.cy, f);
    }
    return { cx, cy, z };
  }

  apply(t: number, extra?: CameraExtra): CameraState {
    const view = this.at(t);
    const z = view.z * (extra?.z || 1);
    const tx = stageSize.width / 2 - view.cx * z + (extra?.x || 0);
    const ty = stageSize.height / 2 - view.cy * z + (extra?.y || 0);
    this.state = { tx, ty, z, cx: view.cx, cy: view.cy };
    this.el.style.transform =
      `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${z.toFixed(5)})` + (extra?.rot ? ` rotate(${extra.rot}deg)` : '');
    return this.state;
  }
}
