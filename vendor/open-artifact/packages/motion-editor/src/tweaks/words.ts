/** The properties panel and tab name. */
export const PROPERTIES = 'Properties';
export const SHOW_PROPERTIES = 'Show the properties panel';
export const HIDE_PROPERTIES = 'Hide the properties panel';
export const ON_SCREEN_NOW = 'On screen now';
export const sceneOf = (number: number, total: number): string => `Scene ${number} of ${total}`;
export const PREVIOUS_SCENE = 'Previous scene';
export const NEXT_SCENE = 'Next scene';
export const SCENE = 'Scene';
export const NAME = 'Name';
export const RESET_NAME = 'Reset Name';
export const LENGTH = 'Length';
export const RESET_LENGTH = 'Reset length';
export const SPEED = 'Speed';
export const SECONDS_UNIT = 's';
export const HALF_SPEED_MARK = '½×';
export const DOUBLE_SPEED_MARK = '2×';
export const HALF_SPEED = 'Half speed, twice as long';
export const DOUBLE_SPEED = 'Double speed, half as long';
export const CANT_GO_SLOWER = 'This scene can’t go slower';
export const CANT_GO_FASTER = 'This scene can’t go faster';
export const RENAME_SCENE = 'Rename…';
export const renameSceneTitle = (name: string): string => `Rename “${name}”`;
export const RENAME = 'Rename';
export const CHANGE_LENGTH = 'Change length…';
export const sceneLengthTitle = (name: string): string => `Length of “${name}”`;
export const SET_LENGTH = 'Set length';
export const CANCEL = 'Cancel';

export const RESET_ALL = 'Reset all changes';
export const resetAllTip = (agent: string): string => `Takes back every change people made to this animation, so it is as ${agent} last made it`;
export const ALL_RESET = 'All changes reset';
export const ALL_BROUGHT_BACK = 'All changes brought back';
export const UNDO_CANT_RUN = 'Undo can’t run right now. Try again in a moment.';

export const SAVE_REFUSED = 'Your change could not be saved. Try again in a moment.';
export const LATER_RECORD = 'This animation was changed by a newer version of the page, so this page leaves those changes as they are.';
