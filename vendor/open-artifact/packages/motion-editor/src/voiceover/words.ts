export const VOICEOVER = 'Voiceover';
export const RECORD_CHANGES = 'Record changes';
export const recordCount = (count: number): string => (count === 1 ? 'Record 1 change' : `Record ${count} changes`);
export const moreWithNextPress = (count: number): string =>
  count === 1 ? '1 more change goes with the next press.' : `${count} more changes go with the next press.`;
export const recordTip = (agent: string): string => `Sends your changes to ${agent} in the chat. The voiceover and captions won’t change until ${agent} has made them.`;
export const waitForAgent = (agent: string): string => `${agent} is working. Record your changes when it’s done.`;
export const READ_ONLY = 'Only people who can edit this video can change its voiceover.';
export const LINE_GOING = 'This line will be taken out';
export const RESET = 'Reset';
export const lineLabel = (number: number): string => `Line ${number}`;
export const goToLine = (number: number, time: string): string => `Go to line ${number} at ${time}`;
export const resetLine = (number: number): string => `Reset Line ${number}`;
export const laneLineLabel = (number: number, time: string, words: string): string => `Line ${number} at ${time}: ${words}`;
export const VOICEOVER_LANE = 'Voiceover lines';
export const MOVE_UNDO_LABEL = 'Voiceover';
export const MOVE_NOT_WRITTEN = 'The voiceover line could not be moved.';

/** How far a line moved, as said: "0.4 s earlier", "1.25 s later". */
export function shiftText(shift: number): string {
  const shown = Number(Math.abs(shift).toFixed(2)).toLocaleString();
  return shift < 0 ? `${shown} s earlier` : `${shown} s later`;
}
