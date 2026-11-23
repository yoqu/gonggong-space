export const TEXT = 'Text';
export const textNumber = (number: number): string => `Text ${number}`;
export const resetText = (number: number): string => `Reset Text ${number}`;
export const WORDS_ON_SCREEN = 'Words on screen';
export const MORE_TEXT = 'More text';
export const ELSEWHERE_IN_SCENE = 'Elsewhere in this scene';
export const NOT_ON_SCREEN = 'Changes not on screen now';
export const fieldlessHint = (agent: string): string =>
  `Some words on the picture have no field here. The animation sets them itself. Ask ${agent} to change them.`;
export const fieldlessNote = (agent: string): string => `The animation sets this text itself. Ask ${agent} to change it.`;
export const changeWords = (words: string): string => `${words}, change`;
export const noTextHere = (agent: string): string => `No text here can be changed. Ask ${agent} instead.`;
export const FINISH_COMMENTING = 'Finish commenting to change text.';
export const PAUSE_TO_CHANGE_TEXT = 'Pause to change text';
export const LINE_GONE = 'That text is no longer in the animation, so your change wasn’t kept.';
export const TOO_MUCH_TEXT = 'You’ve changed too much text to save more. Reset some of it and try again.';
export const TEXT_CHANGED = 'Text changed';
export const TEXT_RESET = 'Text reset';
export const TEXT_CHANGE = 'Text change';
