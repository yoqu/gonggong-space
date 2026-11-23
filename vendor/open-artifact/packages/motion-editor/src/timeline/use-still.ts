import { useEffect, useState } from 'react';
import { playSeconds } from '@open-artifact/motion-core';
import { filmEngine } from '../engine/engine-context.ts';
import { selectFps, useFilm } from '../stores/film.ts';

/** A still of the moment `t` (`width` pixels wide) as an image URL, once the preview stage has drawn it. */
export function useStill(t: number | null, width: number): string | null {
  const revision = useFilm((s) => s.revision);
  const ready = useFilm((s) => s.stage === 'ready');
  const fps = useFilm(selectFps);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const thumbnails = filmEngine()?.thumbnails;
    if (t === null || !ready || thumbnails === undefined || width <= 0) return setUrl(null);
    const at = playSeconds(t);
    const kept = thumbnails.peek(at, fps, width);
    if (kept !== undefined) return setUrl(kept);
    let current = true;
    void thumbnails.get(at, fps, width).then((still) => {
      if (current) setUrl(still);
    });
    return () => {
      current = false;
    };
  }, [t, width, revision, ready, fps]);
  return url;
}
