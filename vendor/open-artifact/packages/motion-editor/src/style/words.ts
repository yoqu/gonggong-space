/** The theme tab's name. */
export const THEME_LABEL = 'Theme';
export const STYLE_TOOLTIP = 'Palette and font';

export const FINDING_STYLE = 'Finding this animation’s colors and fonts…';
export const NOTHING_TO_STYLE = (agent: string): string => `Nothing here can be changed in Theme. Ask ${agent} instead.`;
export const FILM_STOPPED = (agent: string): string => `The animation has stopped with an error. Ask ${agent} to fix it.`;
export const NO_ANIMATION_YET = 'There is no animation to style yet.';

export const FONT_SECTION = 'Font';
export const SAME_AS_BODY = 'Same as Body';
export const SEARCH_FONTS = 'Search fonts';
export const NO_FONTS_MATCH = 'No fonts match.';
export const MORE_GOOGLE_FONTS = 'More from Google Fonts';

export const FONT_UNDO_LABEL = 'Font';
export const PALETTE_UNDO_LABEL = 'Palette';

export const CANNOT_SAVE = 'That change couldn’t be saved. This page can’t change the animation right now.';
export const CANNOT_UNDO = 'That change can no longer be undone.';
export const CANNOT_REDO = 'That change can no longer be redone.';
export const TOO_MANY_FILES = (agent: string): string =>
  `This animation has too many files to save that change. Ask ${agent} to remove the ones it no longer uses.`;
export const LATER_RECORD = 'This animation’s style was set by a newer version of this page, so it can’t be changed here.';

export const lacksLetters = (count: number, names: string): string =>
  count === 1
    ? `${names} lacks some of this animation’s letters, so the original font is shown.`
    : `${names} lack some of this animation’s letters, so the original fonts are shown.`;
