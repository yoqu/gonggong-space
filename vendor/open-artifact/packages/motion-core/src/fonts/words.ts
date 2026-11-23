import type { FontSlot } from './builtin.ts';

/** Why a Google Fonts family is not used, as the notes for the agent end ("…is not in use: <why>."). */
export const FONT_WORDS = {
  stylesheetUnusable: 'its stylesheet names no usable face, so name another family',
  tooManyCharacters: (points: number): string => `the film shows over ${points} different characters, too many to check a family against`,
  lacksCharacter: (character: string): string => `the family lacks "${character}", which the film could show: name a family that has it`,
  overFileRoom: (files: number): string =>
    `it would take more font files than the film has room left for (${files} in all): name fewer weights or families`,
  nothingShown: 'the family has nothing that the film shows, so name another',
  unavailable:
    'Google Fonts gave nothing usable: a blocked network, a family it does not serve, and a file that is too big or holds pictures (a color or emoji font) all look the same, and it is not asked again for a minute or more',
  late: 'it did not come from Google Fonts in time. The page is still waiting for it and, if it comes, loads the film again with it by itself when nothing is in the way: there is nothing to change in the film for now',
  overFilmBytes: (afterOthers: boolean, kib: number): string =>
    `its files${afterOthers ? ', with those of the families before it,' : ''} come to more than the ${kib} KB a film may bring in: name fewer weights or families`,
  playerFailure: 'it could not be fetched, which is a fault in the player, not in the film',
  fetchDisabled: 'this page or tool fetches nothing, and no files of the family are stored with the film, so nothing is wrong with the name',
  storedUnusable:
    'its files are stored with the film but cannot be used here: they could not be read (one of the agent’s own tools never can), lack a letter that the film now shows, or found no room beside the others. Nothing is wrong with the name',
} as const;

/** The notes for the agent about a slot's family. */
export const FONT_NOTE_WORDS = {
  pickedSource: (slot: FontSlot): string =>
    `modules/refaced.json, "${slot}" (a person picked it under Style, so it is theirs to change: pass on any advice here to name something else, and point them to Font)`,
  filmSource: (slot: FontSlot): string => `modules/scenes.json: "fonts"."${slot}"`,
  fallsBackToStandIn: ' That stack falls back to its stand-in ("or"), if that can spell the film.',
  fallsBackToSans: ' That stack is the film’s sans.',
  fallsBackToSystem: ' That stack uses the system’s fonts.',
  notListed: (picked: boolean): string =>
    ` names no family in the player’s list of Google Fonts families, which leaves out those that hold Chinese, Japanese or Korean and those without Latin letters${
      picked ? '.' : ': check the spelling or name another.'
    }`,
  notInUse: (family: string): string => `: ${family} is not in use: `,
  nameStandIn: (family: string): string =>
    ` Name a stand-in as well, a shipped face for wherever the family cannot be fetched, as in {"family": "${family}", "or": "manrope"}.`,
} as const;

/** The Font panel, under Style. */
export const FONT_PANEL_WORDS = {
  original: 'Original',
  builtinGroup: 'Built-in',
  googleGroup: 'Google Fonts',
  rows: {
    head: 'Headline',
    text: 'Text',
    body: 'Body',
    mono: 'Monospace',
    other: 'Other text',
    sans: 'Sans-serif',
    serif: 'Serif',
  },
  slots: { display: 'Headline', sans: 'Sans-serif', serif: 'Serif', mono: 'Monospace' } satisfies Record<FontSlot, string>,
  inFilmGroup: 'In this video',
  glyphFallback: 'Some letters in this video aren’t in its fonts, so it now shows in system fonts.',
  glyphFallbackRestore: 'Some letters in this video aren’t in its fonts, so it now shows in system fonts. Change the word back to get them back.',
  googleFamilyLimit: (most: number): string =>
    `This video already uses ${most} Google Fonts families, the most it can load. Pick a built-in font, or a Google font that isn’t greyed out.`,
} as const;

/** What the panel tells a person of families that could not be shown. */
export const FONT_FALLBACK_WORDS = {
  oneUnloaded: (name: string, other: string): string => `The font ${name} couldn’t be loaded, so this video shows ${other} instead.`,
  unloaded: (count: number, names: string): string =>
    count === 1
      ? `The font ${names} couldn’t be loaded, so this video shows a fallback font instead.`
      : `The fonts ${names} couldn’t be loaded, so this video shows fallback fonts instead.`,
  oneUnknown: (name: string, other: string): string => `${name} isn’t a font this video can load, so it shows ${other} instead.`,
  unknown: (count: number, names: string): string =>
    count === 1
      ? `${names} isn’t a font this video can load, so it shows a fallback font instead.`
      : `${names} aren’t fonts this video can load, so it shows fallback fonts instead.`,
  unloadedKept: (count: number, names: string): string =>
    count === 1
      ? `The font ${names} couldn’t be loaded, so text set in it keeps the video’s own font.`
      : `The fonts ${names} couldn’t be loaded, so text set in them keeps the video’s own font.`,
  crowded: (count: number, names: string, most: number): string =>
    `${count === 1 ? 'The font' : 'The fonts'} ${names} couldn’t be loaded: this video already uses ${most} Google Fonts families, the most it can load. Text set in ${names} keeps the video’s own font.`,
} as const;

/** The weights as the style menus name them. */
export const FONT_WEIGHT_WORDS: Readonly<Record<number, string>> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

export const ITALIC_FONT_WEIGHT_WORDS: Readonly<Record<number, string>> = {
  100: 'Thin italic',
  200: 'Extra light italic',
  300: 'Light italic',
  400: 'Italic',
  500: 'Medium italic',
  600: 'Semibold italic',
  700: 'Bold italic',
  800: 'Extra bold italic',
  900: 'Black italic',
};

/** The notice the licence file gives Google Fonts files. */
export const GOOGLE_FONT_FILE_NOTICE =
  'The page got the font files that go with this text as this family’s files from Google Fonts: it fetched them for the video, or they were stored with the video as fetched. It changes no file that it fetches. Google’s guide for font makers (googlefonts.github.io/gf-guide/license-file.html) says that Google Fonts hands out "a subsetted version" of a font, one cut down to part of its characters, so these may not be the family’s complete files.';

export const MODIFIED_FONT_NOTICE =
  'Modified Version: the font files that go with this text were reduced to a Latin subset of the characters, with other changes. Each file lists them all in its name table, record 10 (description).';

export const MANROPE_FONT_NOTICE =
  'Modified Version: the font files that go with this text are the Latin subset in the package @fontsource/manrope 5.2.8, with only their name tables edited.';
