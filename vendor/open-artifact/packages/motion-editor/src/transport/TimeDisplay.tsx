import type { ReactElement } from 'react';
import { selectDuration, useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { formatPlaybackTime } from './time-format.ts';

/** `0:03 / 0:12`; a screen reader reads the playhead's slider instead. */
export function TimeDisplay(): ReactElement {
  const shown = usePlayback((s) => formatPlaybackTime(s.time));
  const total = useFilm((s) => formatPlaybackTime(selectDuration(s)));
  return (
    <span aria-hidden="true" className="shrink-0 px-1 text-[12px] tabular-nums text-chrome-muted">
      <span className="text-chrome-fg">{shown}</span>
      <span className="@max-[24rem]:hidden"> / {total}</span>
    </span>
  );
}
