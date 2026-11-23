import { create } from 'zustand';
import type { VoiceoverLine } from '@open-artifact/motion-audio';
import { keepTypedFor, lineKeys, withTyped, type TypedWords } from './lines.ts';

export interface VoiceoverState {
  /** The narration's lines as played, with their takes' waveforms; `null`: the film has no narration. */
  lines: readonly VoiceoverLine[] | null;
  /** The lines are the film's on show (false while a changed film's takes are still decoding). */
  fresh: boolean;
  /** Words typed in the Voiceover section, by line key. */
  typed: TypedWords;
  /** The lines sent to the agent to change, by key, until its turn is done. */
  out: ReadonlySet<string>;
  /** A voiceover request is with the agent. */
  asked: boolean;
  /** The line (from 1) whose field has the focus. */
  selected: number | null;
  setLines(lines: readonly VoiceoverLine[] | null, fresh: boolean): void;
  type(key: string, words: string | undefined): void;
  sent(keys: readonly string[]): void;
  settled(): void;
  select(line: number | null): void;
}

const NONE: ReadonlySet<string> = new Set();

export const useVoiceover = create<VoiceoverState>()((set) => ({
  lines: null,
  fresh: false,
  typed: {},
  out: NONE,
  asked: false,
  selected: null,
  setLines: (lines, fresh) =>
    set((state) => ({
      lines,
      fresh,
      // What was typed for a line that is no longer there goes.
      typed: lines === null ? {} : keepTypedFor(state.typed, lineKeys(lines)),
    })),
  type: (key, words) => set((state) => ({ typed: withTyped(state.typed, key, words) })),
  sent: (keys) => set({ out: new Set(keys), asked: true }),
  settled: () => set({ out: NONE, asked: false }),
  select: (selected) => set({ selected }),
}));
