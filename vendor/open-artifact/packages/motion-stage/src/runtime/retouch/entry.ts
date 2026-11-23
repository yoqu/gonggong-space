import type { Corner, Key, Value } from './look.ts';

export interface Pair {
  was: Value;
  v: Value;
}

/** What judging an entry's thing found: whether each of its pairs holds, and the film's own value each is held to. */
export interface Verdict {
  round: Corner[];
  /** The thing is an svg text, whose ink is laid as its fill. */
  art: boolean;
  own: Partial<Record<Key, Value>>;
  holds: Partial<Record<Key, boolean>>;
}

/** Where an entry's thing was found. */
export interface Seat {
  el: Element;
  /** Found by its print, not its turn. */
  sure: boolean;
  /** A hidden g found by its parts once its print was on nothing; `had`, its print then, finds it again. */
  held?: boolean;
  had?: string | null;
  worded: boolean;
  /** Its turn among like things, of how many; n -1: found by `far`, the node alone counts. */
  k: number;
  n: number;
  /** Its print now, if nothing else of its tag has it. */
  print: string | null;
  /** The words it had at the entry's own moment; a later look counts only while it has them. */
  says?: string;
}

export interface Told {
  verdict: Verdict;
  seat: Seat;
  /** What is laid on the element, as its data-film-laid says it. */
  laid: string;
  lapsed: string;
}

/** One entry of the record as this stage lays it. */
export interface Entry {
  id: string;
  /** Its own moment, in its stretch's own seconds. */
  at: number;
  /**
   * The verdicts by the start of the stretch they were reached in. Absent: not told yet. null: nothing could be told
   * in this load. false: its thing was not there.
   */
  told: Map<number, Told | null | false>;
  scene: string;
  tag: string;
  cls: string[];
  kin: string;
  k: number;
  n: number;
  print: string | null;
  /** The hashes a hide on a g inside an svg is also found by (`parts.ts`). */
  parts: string[] | null;
  pairs: Partial<Record<Key, Pair>>;
}

/** One like thing on the stage: an element of a tag, its classes as they were read, and its print once made. */
export interface Peer {
  el: Element;
  cls: string[];
  print: string | null;
}

/** What is known of the stage as drawn at one moment, made as it is needed. */
export interface ReadMemo {
  all?: Element[];
  art?: Element[];
  tags?: Map<string, Peer[]>;
  turns?: Map<Element, string>;
  words?: Map<Element, string>;
  drawn?: Map<Element, string>;
  /** For `parts.ts`: the paint each holder lends, each piece's hash, and the stage's shapes tallied. */
  lent?: Map<Element, string>;
  written?: Map<Element, string>;
  pieces?: Map<string, number>;
}
