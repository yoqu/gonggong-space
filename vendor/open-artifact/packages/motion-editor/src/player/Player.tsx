import type { ReactElement } from 'react';
import { CommentLayer } from '../comments/CommentLayer.tsx';
import { togglePlay } from '../engine/actions.ts';
import { useComments } from '../comments/comments.ts';
import { useFilm } from '../stores/film.ts';
import { ComingScene } from './ComingScene.tsx';
import { EndedOffers } from './EndedOffers.tsx';
import { FilmStates } from './FilmStates.tsx';
import { StageView } from './StageView.tsx';
import { WorkingBar } from './WorkingBar.tsx';

/** The picture and everything over it; a click on the picture plays or pauses (not in comment mode). */
export function Player(): ReactElement {
  const ready = useFilm((s) => s.stage === 'ready');
  const commenting = useComments((s) => s.on);
  return (
    <div className="relative min-h-0 flex-1" data-video-player="">
      <StageView under={ready && !commenting ? <div aria-hidden="true" className="absolute inset-0" onClick={togglePlay} /> : null}>
        <ComingScene />
        <FilmStates />
        <WorkingBar />
        <EndedOffers />
        <CommentLayer />
      </StageView>
    </div>
  );
}
