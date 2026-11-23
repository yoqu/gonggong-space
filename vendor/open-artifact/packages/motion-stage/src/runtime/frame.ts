import type { FilmSeconds } from '@open-artifact/motion-core';
import type { HostToStage, StageToHost } from '../protocol.ts';
import { filmTime, realNow } from './determinism.ts';
import { film } from './film.ts';
import { say } from './port.ts';
import { RenderStuck, afterSample, holdStage, nextTask, releaseStage, renderAt, renderState, rendersSettle, syncClips, takeTurn, unsettledNow } from './render.ts';
import { scanStage } from './scan.ts';
import { PLAIN_INK, forcedColorsActive, inOwnColors, serializeForRaster, svgForRaster } from './snapshot/serialize.ts';
import { builtStage } from './stage.ts';
import { stageSize } from './stage-size.ts';
import { warnOnce } from './video-sync.ts';

type FrameAsk = Extract<HostToStage, { type: 'frame' }>;
type FrameReply = Extract<StageToHost, { type: 'frame' }>;

/** A pull that only inspects the picture: past this, the page could not use it anyway. */
export const SMALL_SNAPSHOT_MAX_CHARS = 1000000;
/** With the pull's own render (up to 10 s) and its clips, a pull fits the host's 15 s for a frame. */
const REDRAW_BUDGET_MS = 12000;
const MOST_PASSES = 3;

function snapshot(ask: FrameAsk, scale: number, t: FilmSeconds): Omit<FrameReply, 'ms'> {
  scanStage();
  const parts = builtStage();
  const { width, height } = stageSize;
  // The snapshot lacks the stage root, so under forced colors it is given the root's text color.
  const { ink, xml } = inOwnColors(() => ({
    ink: forcedColorsActive() ? getComputedStyle(document.documentElement).color || PLAIN_INK : undefined,
    xml: serializeForRaster(parts.stage, {
      width,
      height,
      mediaScale: ask.smallMedia ? scale : 1,
      fx: ask.readFx ? null : parts.fxWatch,
      smoothAt: ask.smooth ? scale : 0,
      warn: warnOnce,
    }),
  }));
  const made = svgForRaster(xml, width, height, scale, ink);
  if (ask.smallMedia && made.svg.length > SMALL_SNAPSHOT_MAX_CHARS) throw new Error('the stage is too large to inspect: its snapshot is ' + made.svg.length + ' characters');
  return { type: 'frame', seq: ask.seq, t, svg: made.svg, pw: made.pw, ph: made.ph };
}

const failure = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/** Draws the asked moment and answers with its snapshot, after any live render still painting has settled. */
export function pullFrame(ask: FrameAsk): void {
  const scale = ask.scale > 0 && ask.scale <= 4 ? ask.scale : 1;
  takeTurn(async () => {
    if (!film.loaded) {
      say({ type: 'frame-error', seq: ask.seq, hold: true, env: true, message: 'the film is not loaded' });
      return;
    }
    const began = realNow();
    holdStage();
    let rendered = false;
    try {
      const wait = rendersSettle();
      if (wait) await wait;
      /*
       * A render a wait gave up on may settle while this pull draws and paint its own moment over this one: then
       * this moment is drawn again, twice at most. Only the renders pending as the pull begins count.
       */
      const before = unsettledNow();
      let kept: Omit<FrameReply, 'ms'> | null = null;
      let late = true;
      let drawnAt: FilmSeconds = filmTime();
      for (let passes = 0; late && passes < MOST_PASSES; passes++) {
        const still = before.filter((entry) => !entry.done);
        const passBegan = realNow();
        let awaited = false;
        try {
          rendered = false;
          const sampled = renderState.gavePromise;
          let drawn = renderAt(ask.t);
          if (!renderState.ok) throw failure(renderState.error);
          if (drawn) {
            awaited = true;
            await drawn;
          }
          // A sample this draw began goes first, and this moment is drawn again: nothing else draws meanwhile, since this pull holds the stage.
          const again = afterSample(sampled, ask.t);
          if (again) {
            awaited = true;
            drawn = (await again).q;
            if (!renderState.ok) throw failure(renderState.error);
            if (drawn) await drawn;
          }
          rendered = true;
          drawnAt = filmTime();
          // A pull that only inspects the picture waits at most 250 ms for a clip.
          const clips = syncClips('frame', ask.smallMedia);
          if (clips) {
            awaited = true;
            await clips;
          }
        } catch (error) {
          // A redraw that fails answers with the pass before; one that never settled may still paint, so it fails the pull.
          if (kept === null || error instanceof RenderStuck) throw error;
          break;
        }
        // A render is marked done a few promise steps after it paints.
        if (still.length && awaited) await nextTask();
        late = awaited && still.some((entry) => entry.done) && 2 * realNow() - began - passBegan < REDRAW_BUDGET_MS;
        kept = late ? snapshot(ask, scale, drawnAt) : null;
      }
      const out = kept ?? snapshot(ask, scale, drawnAt);
      say({ ...out, ms: Math.round(realNow() - began) });
    } catch (error) {
      const fatal = error instanceof RenderStuck;
      const message = String(error instanceof Error ? error.message : error).slice(0, 300);
      say({
        type: 'frame-error',
        seq: ask.seq,
        hold: !fatal,
        env: fatal && error.inBackground,
        message: rendered || fatal ? message : 'render(' + filmTime().toFixed(3) + ') threw: ' + message,
      });
    } finally {
      releaseStage();
    }
  });
}
