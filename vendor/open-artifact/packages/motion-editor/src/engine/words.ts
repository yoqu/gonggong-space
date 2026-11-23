export const STAGE_TITLE = 'Animation';
export const PREVIEW_STAGE_TITLE = 'Animation preview';
export const LOAD_TOO_SLOW = 'The animation took too long to load.';
export const STAGE_NAVIGATED = 'The animation’s code left its stage while it loaded.';
export const STAGE_VERSION_MISMATCH = 'The player and the stage do not match. Reload the page.';
export const NO_FILM_ON_STAGE = 'no film on the stage';
export const STAGE_GONE = 'the stage was taken down';
export const ANOTHER_FILM_LOADED = 'the stage loaded another film';
export const frameTimedOut = (t: number, seconds: number): string =>
  `Frame ${t.toFixed(3)} s did not render within ${seconds} s (is this tab in the background?).`;
export const SOUND_FAILED = 'The animation’s sound could not be prepared, so it plays silent.';
export const endedLinesNotice = (agent: string, count: number, words: string): string =>
  count === 1 ? `${agent} rewrote a line, so the “${words}” typed by hand no longer shows.` : `${agent} rewrote ${count} lines, so the text typed by hand no longer shows.`;
export const askToPutBack = (agent: string): string => `Ask ${agent} to put it back`;
export const undid = (label: string): string => `Undid: ${label}`;
export const redid = (label: string): string => `Redid: ${label}`;
export const NOTHING_TO_UNDO = 'Nothing to undo';
export const NOTHING_TO_REDO = 'Nothing to redo';
export const UNDO = 'Undo';
export const REDO = 'Redo';
