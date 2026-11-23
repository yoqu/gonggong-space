/** The toolbar's shape menu: asks the agent for the film again in another shape, or opens the dialog for a ratio. */

import { FILM_SHAPES } from '@open-artifact/motion-core';
import { ChromeMenu, ChromeMenuItem, ChromeMenuLabel, ChromeMenuSeparator, ToolButton } from '@open-artifact/editor-kit/react';
import { Ratio } from 'lucide-react';
import type { ReactNode } from 'react';
import { askShape } from '../agent/requests.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { openExport, pick } from './run.ts';
import { otherShapeIds, ownShapeLabel, typedStart } from './shapes.ts';
import * as words from './words.ts';

export function ShapeMenu(): ReactNode {
  const meta = useFilm((state) => (state.stage === 'ready' ? state.meta : null));
  const canAsk = useWorking((state) => state.canAsk);
  const agent = useWorking((state) => state.name);
  if (meta === null || !canAsk) return null;
  const own = { width: meta.width, height: meta.height };
  return (
    <ChromeMenu side="top" align="end" trigger={<ToolButton label={words.ANOTHER_SHAPE} size="lg" icon={<Ratio />} />}>
      <ChromeMenuLabel>{ownShapeLabel(own)}</ChromeMenuLabel>
      {otherShapeIds(own).map((id) => (
        <ChromeMenuItem key={id} onSelect={() => void askShape(FILM_SHAPES[id])} title={words.shapeSecondAnimation(agent)}>
          {words.shapeLabel(words.SHAPE_NAMES[id], FILM_SHAPES[id].ratio)}
        </ChromeMenuItem>
      ))}
      <ChromeMenuSeparator />
      <ChromeMenuItem
        onSelect={() => {
          openExport();
          pick({ shape: typedStart(own) });
        }}
      >
        {words.OTHER_RATIO}
      </ChromeMenuItem>
    </ChromeMenu>
  );
}
