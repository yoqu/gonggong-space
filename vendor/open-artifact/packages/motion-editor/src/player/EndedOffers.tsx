import type { ReactElement } from 'react';
import { RotateCcw, Shapes } from 'lucide-react';
import { Button, Menu, MenuItem } from '@open-artifact/ui';
import { FILM_SHAPES, FILM_SHAPE_IDS } from '@open-artifact/motion-core';
import { askShape } from '../agent/requests.ts';
import { restart } from '../engine/actions.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import * as words from './words.ts';

/** The shapes other than the film's own. */
export function otherShapes(width: number, height: number): typeof FILM_SHAPE_IDS[number][] {
  return FILM_SHAPE_IDS.filter((id) => FILM_SHAPES[id].width * height !== FILM_SHAPES[id].height * width);
}

/** At the end (not looping): play again, or ask for the film in another shape. */
export function EndedOffers(): ReactElement | null {
  const ended = usePlayback((s) => s.ended && !s.playing);
  const width = useFilm((s) => s.meta?.width ?? 0);
  const height = useFilm((s) => s.meta?.height ?? 0);
  const canAsk = useWorking((s) => s.canAsk);
  if (!ended) return null;
  const shapes = canAsk && width > 0 && height > 0 ? otherShapes(width, height) : [];
  return (
    <div className="absolute inset-x-0 bottom-4 z-[6] flex justify-center gap-2">
      <Button variant="primary" size="lg" icon={<RotateCcw className="size-4" aria-hidden="true" />} onClick={() => restart()}>
        {words.PLAY_AGAIN}
      </Button>
      {shapes.length > 0 ? (
        <Menu
          side="top"
          align="center"
          trigger={
            <Button size="lg" icon={<Shapes className="size-4" aria-hidden="true" />}>
              {words.ANOTHER_SHAPE}
            </Button>
          }
        >
          {shapes.map((id) => (
            <MenuItem key={id} onSelect={() => void askShape(FILM_SHAPES[id])}>
              {words.shapeLabel(FILM_SHAPES[id].ratio, words.SHAPE_NAMES[id])}
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </div>
  );
}
