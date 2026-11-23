/** The hue names a palette is called by. */
export type HueName = 'Pink' | 'Red' | 'Orange' | 'Amber' | 'Yellow' | 'Lime' | 'Green' | 'Teal' | 'Sky' | 'Blue' | 'Violet' | 'Magenta' | 'Brown' | 'Olive' | 'Gray';

/** How a palette card is named: after its hue alone, or as its hue on a dark or light ground. */
export type PaletteNameForm = 'palette' | 'dark' | 'light';

export const PALETTE_WORDS = {
  section: 'Palette',
  own: 'This animation’s own palette',
  ownYours: 'This animation’s own palette, yours',
  yours: 'Yours',
  yoursNumbered: (count: number): string => `Yours ${count}`,
  named: (hue: HueName, form: PaletteNameForm): string => {
    switch (form) {
      case 'palette':
        return `${hue} palette`;
      case 'dark':
        return `${hue} on dark`;
      case 'light':
        return `${hue} on light`;
    }
  },
  numbered: (name: string, count: number): string => `${name} ${count}`,
  couldNotPlayUndone: 'The animation couldn’t play in that palette, so the change was undone.',
  cannotPlay: 'The animation can’t play in that palette, so it shows its own.',
  cannotPlayPickAnother: 'The animation can’t play in that palette, so it shows its own. Pick another under Theme.',
  textChangedFirst: 'The animation can’t play with the text changed in Properties, so it shows the original. Reset the text, then pick a palette.',
  changeRedone: 'Palette change redone',
  changeUndone: 'Palette change undone',
} as const;
