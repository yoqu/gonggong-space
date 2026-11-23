const seconds = (value: number): string => String(Math.round(value * 10) / 10);

export const sceneLasts = (number: number, length: number): string => `Scene ${number} now lasts ${seconds(length)} seconds`;
export const sceneRenamed = (number: number): string => `Scene ${number} renamed`;
export const LENGTH_CHANGE = 'Length change';
export const NAME_CHANGE = 'Name change';
export const tooShortAt = (scene: string, minimum: number): string =>
  `${scene} can’t be shorter than ${seconds(minimum)} seconds. Any shorter could flash too fast.`;
export const tooShortNow = (scene: string): string => `${scene} can’t be shorter. At this length, it could already flash too fast. Make it longer.`;
export const uncheckedAt = (scene: string, minimum: number): string =>
  `${scene} can’t be shorter than ${seconds(minimum)} seconds, because it couldn’t be checked for flashing.`;
export const UNCHECKED_NOW = 'This scene couldn’t be checked for flashing, so it can’t be any shorter.';
export const PAUSE_TO_SHORTEN = 'Pause the animation to make this scene shorter.';
export const lengthLapsed = (agent: string, scene: string): string =>
  `${agent} changed the length of ${scene === '' ? 'a scene' : scene}, so the one set by hand no longer applies.`;
export const overLimit = (agent: string): string =>
  `The lengths set by hand would take the animation past 5 minutes, so it plays at ${agent}’s lengths.`;
export const DRAG_LENGTH = 'Drag, or press the arrow keys, to change its length';
export const sceneLength = (number: number): string => `Length of scene ${number}`;
export const sceneLengthHint = (length: number): string => `${seconds(length)} s`;
