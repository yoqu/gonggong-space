/**
 * The export's view of the film engine: the film's facts, frames pulled from the stage on show, the sound as played,
 * and the stage lent for the length of an export (playback paused, no new film loaded until it is given back).
 */

import { DEFAULT_VIDEO_TITLE, EXPORT_SETTINGS } from '@open-artifact/motion-core';
import type { FilmFacts, FrameSource, StageFrame } from '@open-artifact/motion-export';
import { pause } from '../engine/actions.ts';
import type { FilmEngine } from '../engine/film-engine.ts';
import { StageFrameError, StageGoneError } from '../engine/frame-errors.ts';
import { useFilm } from '../stores/film.ts';

/** A failed pull as the export reads it; anything the controller did not say why of is held, and the film's. */
export function frameFailure(error: unknown): StageFrame {
  if (error instanceof StageGoneError) return { kind: 'unloaded' };
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof StageFrameError) return { kind: 'failed', message, hold: error.hold, env: error.env };
  return { kind: 'failed', message, hold: true, env: false };
}

/** The facts an export plans with, from what the stage reported; null until a film is on show. */
export function filmFacts(): FilmFacts | null {
  const { meta, film, stage } = useFilm.getState();
  if (stage !== 'ready' || meta === null) return null;
  const title = film?.meta?.title.trim() ?? '';
  return { title: title === '' ? DEFAULT_VIDEO_TITLE : title, width: meta.width, height: meta.height, fps: meta.fps, duration: meta.duration };
}

/**
 * Lends the stage: playback pauses and films the engine builds meanwhile wait; giving it back loads the newest of
 * them, or shows the playhead's moment again.
 */
function lendStage(engine: FilmEngine): () => Promise<void> {
  pause();
  const release = engine.holdLoads();
  let given = false;
  return async () => {
    if (given) return;
    given = true;
    if (!release() && !engine.holdsLoads) engine.playback.seek(engine.playback.time);
  };
}

export function editorFrameSource(engine: FilmEngine): FrameSource {
  return {
    facts: filmFacts,
    async frame(t, request) {
      if (!engine.stage.live) return { kind: 'unloaded' };
      try {
        const answer = await engine.stage.pullFrame({ t, ...request });
        return { kind: 'picture', svg: answer.svg, pw: answer.pw, ph: answer.ph };
      } catch (error) {
        return frameFailure(error);
      }
    },
    sound: () => (useFilm.getState().meta === null ? null : engine.sound.sound),
    borrow: () => lendStage(engine),
    clippedTextWaitMs: () => EXPORT_SETTINGS.clippedTextWaitMs,
  };
}
