import { readRecordInput } from './json.ts';

/** Features a host or a developer may turn off. */
export interface VideoFlags {
  /** Export a QuickTime Animation `.mov` that keeps a transparent background. */
  movExport: boolean;
  /** Put the score in the code export as a `.mid` file. */
  midiExport: boolean;
  /** Run the stage on the page's own origin instead of an opaque one. */
  stageSameOrigin: boolean;
}

export const DEFAULT_VIDEO_FLAGS: VideoFlags = { movExport: true, midiExport: true, stageSameOrigin: true };

const FLAG_NAMES = Object.keys(DEFAULT_VIDEO_FLAGS) as (keyof VideoFlags)[];

/** The defaults with every boolean `input` names in place of its own. */
export function readVideoFlags(input: unknown): VideoFlags {
  const record = readRecordInput(input);
  const flags = { ...DEFAULT_VIDEO_FLAGS };
  if (record === null) return flags;
  for (const name of FLAG_NAMES) {
    const value = record[name];
    if (typeof value === 'boolean') flags[name] = value;
  }
  return flags;
}
