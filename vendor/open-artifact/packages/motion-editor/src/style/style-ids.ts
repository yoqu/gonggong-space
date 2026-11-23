import type { FilmState } from '../stores/film.ts';

export const STYLE_PANEL_ID = 'style';

/** Theme is offered for a film made of scenes (one with `scenes.json`). */
export const showsStyle = (film: Pick<FilmState, 'scenes'>): boolean => film.scenes !== null;
