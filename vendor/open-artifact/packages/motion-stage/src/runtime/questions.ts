import type { FilmSeconds, PlaySeconds, RetouchedRecord } from '@open-artifact/motion-core';
import type { AskedLook, HostToStage, LayerLook, LayersReport } from '../protocol.ts';
import { filmTime } from './determinism.ts';
import { film } from './film.ts';
import { scanLayers } from './layers/scan.ts';
import { say } from './port.ts';
import { afterSample, drawOwn, holdStage, onShow, releaseStage, renderAt, renderState, rendersSettle, setShown, syncClips, takeTurn, unretouched } from './render.ts';
import { ask, lookOn } from './retouch/ask.ts';
import { kinFor, lostIn, partsFor, setRecord, stageOf, underHideIn } from './retouch/retouch.ts';
import { laidOut, whenLaidOut } from './stage.ts';
import { stretchOf } from './stretch.ts';
import type { Stretch } from './stretch.ts';

type LayersAsk = Extract<HostToStage, { type: 'layers' }>;
type LookAsk = Extract<HostToStage, { type: 'look' }>;

const messageOf = (error: unknown): string => String(error instanceof Error ? error.message : error).slice(0, 200);
const quiet = (q: Promise<unknown> | null): void => {
  q?.then(undefined, () => undefined);
};

/** A moment of this stretch and of no other: short of its end, the next one's first moment, rounded down, and not before its start. */
const momentIn = (s: Stretch, T: number): number => Math.max(s.lo, Math.floor(Math.min(s.hi - 1 / 240, T - s.base) * 1000) / 1000);

/** Takes the record of what a person changed by hand; a fault costs their changes, not the film. */
export function takeRecord(record: RetouchedRecord | null): void {
  try {
    setRecord(record);
  } catch {
    unretouched();
  }
}

/**
 * A look that is being tried (a drag on a slider), or the record a load brought. It takes the marks off the one
 * stage, so it takes its turn with the frame pulls.
 */
export function tryLook(record: RetouchedRecord | null): void {
  takeTurn(async () => {
    const wait = rendersSettle();
    if (wait) await wait;
    takeRecord(record);
    if (!film.loaded) return;
    const sampled = renderState.gavePromise;
    quiet(renderAt(onShow()));
    // A sample this draw began: the moment on show is drawn again after it, unless a live frame is on its way.
    const again = afterSample(sampled, onShow);
    if (again) quiet((await again).q);
  });
}

/**
 * Draws a moment at once for a reading. A render that returns a promise has not drawn yet when it returns, so what
 * stands on the stage is of no one moment: better no list than boxes that lie elsewhere.
 */
function drawNow(t: number): void {
  const drawn = renderAt(t as PlaySeconds);
  if (drawn) {
    quiet(drawn);
    throw new Error('render(t) returns a promise');
  }
}

let layersWanted = 0;
/** A new frame is laid out a moment after it is shown: a reading asked for before then waits this long for it. */
const LAYOUT_WAIT_MS = 2000;

/** A reading takes its turn with the frame pulls, since it draws on the one stage. A newer question, or a stop, ends one under way. */
export function readLayers(d: LayersAsk): void {
  layersWanted = d.seq;
  if (d.stop) return;
  takeTurn(async () => {
    let report: LayersReport | null = null;
    if (film.loaded && d.seq === layersWanted && !laidOut()) await whenLaidOut(LAYOUT_WAIT_MS);
    const stage = stageOf();
    if (film.loaded && stage && d.seq === layersWanted) {
      holdStage();
      try {
        report = await scanLayers(
          d,
          {
            stage,
            render: drawNow,
            look: (el: Element): LayerLook | null => {
              const s = stretchOf(filmTime());
              const k = lookOn(el, s.lo, s.hi, s.name);
              if (k) k.at = momentIn(s, filmTime()) as FilmSeconds;
              return k;
            },
            kin: kinFor,
            parts: partsFor,
            lost: () => {
              const s = stretchOf(filmTime());
              return s.name === null ? [] : lostIn(s.name, s.lo, s.hi);
            },
            underHide: () => {
              const s = stretchOf(filmTime());
              return s.name === null ? [] : underHideIn(s.name, s.lo, s.hi);
            },
          },
          () => d.seq !== layersWanted,
        );
      } catch (error) {
        console.warn('layers: ' + messageOf(error));
      } finally {
        releaseStage();
      }
    }
    say({ type: 'layers', report: report ?? { seq: d.seq, from: d.from, to: d.to, at: d.at, lost: [], underHide: [], rows: null } });
  });
}

let lookWanted = 0;

/**
 * How the film itself draws one thing, for the controls that change it. d.t: the moment the page has on show, drawn
 * first, which sets the marks the answer tells of, and again at the end. A question a newer one has overtaken by its
 * turn is answered with no look, and draws nothing.
 */
export function lookAt(d: LookAsk): void {
  lookWanted = d.seq;
  takeTurn(async () => {
    let look: AskedLook | null = null;
    let lost: string[] = [];
    if (film.loaded && d.seq === lookWanted) {
      holdStage();
      try {
        const wait = rendersSettle();
        if (wait) await wait;
        const t = d.t !== null && Number.isFinite(d.t) ? d.t : onShow();
        const sampled = renderState.gavePromise;
        let away = false;
        try {
          const drawn = renderAt(t);
          const s = stretchOf(filmTime());
          const at = momentIn(s, filmTime());
          const name = s.name;
          if (drawn) await drawn.then(undefined, () => undefined);
          else if (renderState.ok && name !== null) {
            away = true;
            look = ask(name, d.id, s.lo, s.hi, at, (x) => drawOwn(s.base + Math.max(s.lo, Math.min(s.hi - 1 / 240, x))));
            lost = lostIn(name, s.lo, s.hi);
          }
        } catch (error) {
          look = null;
          console.warn('How the film draws a thing could not be read, so the page offers no way to change it: ' + messageOf(error));
        }
        if (away) {
          setShown(t);
          quiet(renderAt(t));
          quiet(syncClips('hold'));
        }
        // A sample its draws began goes first, and the moment is drawn again before the answer.
        const again = afterSample(sampled, t);
        if (again) {
          quiet((await again).q);
          quiet(syncClips('hold'));
        }
      } catch {
        // The next frame draws it.
      } finally {
        releaseStage();
      }
    }
    say({ type: 'looked', seq: d.seq, id: d.id, look, lost });
  });
}
