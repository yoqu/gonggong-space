import { create } from 'zustand';

/** `unknown` until the host says; `working` while an available agent is busy; `idle` once it has been quiet a moment. */
export type AgentActivity = 'unknown' | 'working' | 'idle';

/** How the page reaches the film's store. */
export type SyncState = 'connecting' | 'cached' | 'live' | 'unavailable';

/** A request to go on with the film that the agent has not taken up yet. */
export type AskedRequest = 'continue' | 'finalize';

export interface WorkingState {
  activity: AgentActivity;
  /** An agent can receive requests. */
  available: boolean;
  /** Its display name. */
  name: string;
  /** `false`: an idle agent is not woken by a request (it waits until the person next talks to it). */
  wakesIdle: boolean;
  /** The agent asked the person something and its work waits on the answer (it still counts as working). */
  waitsOnYou: boolean;
  asked: AskedRequest | null;
  /** When someone other than this page last changed the film (ms since the epoch). */
  lastFilmWriteAt: number | null;
  sync: SyncState;
  /** Why the page cannot write (a viewer, or no store), or `null`. */
  readOnlyReason: string | null;
  /** The viewer may send requests to the agent. */
  canAsk: boolean;
  setAsked(asked: AskedRequest | null): void;
}

export const useWorking = create<WorkingState>()((set) => ({
  activity: 'unknown',
  available: false,
  name: 'Agent',
  wakesIdle: true,
  waitsOnYou: false,
  asked: null,
  lastFilmWriteAt: null,
  sync: 'connecting',
  readOnlyReason: null,
  canAsk: false,
  setAsked: (asked) => set({ asked }),
}));

/** The agent's display name, for words that name it. */
export const agentName = (): string => useWorking.getState().name;
