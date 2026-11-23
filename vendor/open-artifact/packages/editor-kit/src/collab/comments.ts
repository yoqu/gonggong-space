/**
 * Comment threads for any editor: the store (threads, comment mode, the
 * open card, the draft, the list), and the thread actions over the
 * `comments` capability.
 *
 * Editor-agnostic: what an anchor is,
 * how it is labelled, where it points the agent and how the editor shows it
 * are the {@link CommentsAdapter}'s. The editor hands the capability to
 * {@link CommentsController.start}.
 */

import type { CommentsCapability, CommentThread, JsonRecord } from '@open-artifact/runtime';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AnchorState } from './pins.ts';

/** Longest message. */
export const COMMENT_TEXT_MAX = 4000;

/** What an editor tells the comments controller. `A` is its anchor type. */
export interface CommentsAdapter<A> {
  /** Shows a short message (a toast); default: nothing. */
  notify?(message: { title: string; description?: string }): void;
  /** Reads a stored anchor; anything unreadable should come back as a whole-document anchor. */
  parse(text: string): A;
  serialize(anchor: A): string;
  /** A short label of what the anchor names ("Button “Sign up” in Home"). */
  label(anchor: A): string;
  /** Location details stored with the thread for the agent. */
  location?(anchor: A): JsonRecord;
  /** How the anchor resolves now (default `ok`). */
  state?(anchor: A): AnchorState;
  /** What a card says about an anchor that is not where it was made (default: a generic sentence). */
  stateNote?(state: AnchorState): string | null;
  /** Brings a thread's anchor into view (page, camera); the card opens after it. */
  reveal?(anchor: A): void;
  /** The viewer may write comments (commenters and up). */
  canComment(): boolean;
  /** The viewer may hand threads to the agent (usually the owner, with an agent connected). */
  canSendToAgent(): boolean;
  /** The agent's name in toasts. */
  agentName?(): string;
  /** false: the agent is not woken while it idles, so the toast tells the person to message it. */
  agentWakesIdle?(): boolean | undefined;
  /** The viewer's name (the new comment's pin shows their initials; default `You`). */
  viewerName?(): string;
  /** Comment mode turned on or off (end text editing, pick the select tool…). */
  onModeChange?(on: boolean): void;
  /** What the document is called in messages (default `document`). */
  noun?: string;
  /** Most threads one document keeps (default 500). */
  maxThreads?: number;
  /**
   * Checks a message before it is sent: the text to send, or `undefined` to
   * send nothing (after telling the person why). Default: trimmed and cut
   * to {@link COMMENT_TEXT_MAX} characters.
   */
  checkText?(text: string): string | undefined;
  /** What the agent reads about an anchor, stored with a new thread. */
  detail?(anchor: A): string | undefined;
  /** The viewer may delete threads (default: anyone who may comment). */
  canRemove?(): boolean;
  /**
   * Hands a thread to the agent the editor's way (its own request tracking
   * and messages); resolves whether it was sent. Default: the capability's
   * `sendToAgent` and a "Sent to …" message.
   */
  sendToAgent?(thread: CommentThread, anchor: A): Promise<boolean>;
  /** Told of threads as the host hands them over: the list, every change and every write. */
  heard?(threads: readonly CommentThread[]): void;
  /** A new thread's card opens once it is saved (default: always); `sent`: it went to the agent too. */
  opensCreated?(sent: boolean): boolean;
}

/** The comments store. */
export interface CommentsState<A> {
  available: boolean;
  threads: CommentThread[];
  /** Comment mode: presses on the surface start threads. */
  on: boolean;
  /** The thread list is open. */
  listOpen: boolean;
  /** The thread shown in a card. */
  active: string | null;
  /** A thread being written (its anchor chosen, no message yet). */
  draft: A | null;
  /** Show resolved threads (pins and list). */
  showResolved: boolean;
  /** The new-comment composer's "Send to agent" box (starts off; kept while the composer is moved to another spot). */
  sendNew: boolean;
  /** The new-comment composer's text (kept while it is moved to another spot). */
  draftText: string;
  /** Each thread's reply box: text and its "Send to agent" box (kept while the card closes and opens). */
  replies: Record<string, { text: string; send: boolean }>;
  /**
   * A resolve or reopen the host has not answered yet. The thread already shows its new status; until the answer
   * comes, no other thread can be resolved or reopened and the thread menus wait.
   */
  statusChange: StatusChange | null;
  setOn(on: boolean): void;
  setListOpen(open: boolean): void;
  setActive(id: string | null): void;
  setDraft(draft: A | null): void;
  setShowResolved(show: boolean): void;
  setSendNew(send: boolean): void;
  setDraftText(text: string): void;
  setReply(id: string, reply: { text: string; send: boolean }): void;
}

/** A thread's status, set before the host has confirmed it. */
export interface StatusChange {
  id: string;
  status: CommentThread['status'];
}

/** What a menu says while a status change is on its way. */
export const WAIT_FOR_STATUS_CHANGE = 'Wait for the current change to finish.';

/** The threads as shown: the stored ones, with an unconfirmed status change already applied. */
export function withStatusChange(threads: CommentThread[], change: StatusChange | null): CommentThread[] {
  if (!change) return threads;
  return threads.map((thread) => (thread.id === change.id ? withStatus(thread, change.status) : thread));
}

function withStatus(thread: CommentThread, status: CommentThread['status'], resolvedBy?: CommentThread['resolvedBy']): CommentThread {
  if (thread.status === status && thread.resolvedBy === resolvedBy) return thread;
  const { resolvedBy: _, ...rest } = thread;
  return status === 'resolved' && resolvedBy ? { ...rest, status, resolvedBy } : { ...rest, status };
}

/** One editor's comments. */
export interface CommentsController<A> {
  readonly store: UseBoundStore<StoreApi<CommentsState<A>>>;
  readonly adapter: CommentsAdapter<A>;
  /** Loads the threads and keeps them current; `open` is a thread id to reveal (`?comment=`). */
  start(capability: CommentsCapability | null, open?: string | null): Promise<void>;
  /** Stops following the capability's changes. */
  stop(): void;
  capability(): CommentsCapability | null;
  canComment(): boolean;
  canSendToAgent(): boolean;
  /** The viewer may delete threads. */
  canRemove(): boolean;
  anchorOf(thread: Pick<CommentThread, 'anchor'>): A;
  labelOf(anchor: A): string;
  stateOf(anchor: A): AnchorState;
  stateNote(state: AnchorState | undefined): string | null;
  /** Starts a thread (`send`: and hands it to the agent); resolves whether it was saved. */
  create(anchor: A, text: string, options?: { send?: boolean }): Promise<boolean>;
  /** Replies to a thread (`send`: and hands it to the agent; a resolved thread reopens); resolves whether it was saved. */
  reply(id: string, text: string, options?: { send?: boolean }): Promise<boolean>;
  /**
   * Resolves or reopens a thread. It shows the new status at once (a resolved card closes); if the host refuses, it
   * goes back and its card reopens. One at a time: ignored while another change is waiting for the host.
   */
  resolve(id: string, resolved: boolean): Promise<void>;
  remove(id: string, messageId?: string): Promise<void>;
  move(id: string, anchor: A): Promise<void>;
  /** Hands a thread to the agent; resolves whether it was sent. */
  sendToAgent(id: string): Promise<boolean>;
  sendAllToAgent(): Promise<void>;
  /** Whether a thread has something from a person the agent has not been handed (open, a person's message, not sent or answered since). */
  canSendThread(thread: CommentThread): boolean;
  reveal(thread: CommentThread): void;
  /** Shows a thread where it is: comment mode on, its anchor in view, its card open (the "All comments" panel's rows). */
  show(thread: CommentThread): void;
  /** The viewer's name. */
  viewerName(): string;
}

/** Open (unresolved) thread count. */
/** Under a thread sent to the agent that has not taken it yet; one that is not woken while it idles needs a message. */
export function queuedNote(agent: { name: string; wakesIdle?: boolean }): string {
  return agent.wakesIdle === false ? `${agent.name} gets this on its next turn: send it a message to start one` : 'Waiting for the agent';
}

/** The toast after a thread goes to the agent; one that is not woken while it idles needs a message from the person. */
export function sentNotice(name: string, wakesIdle: boolean | undefined): { title: string; description?: string } {
  return wakesIdle === false
    ? { title: `Sent to ${name}`, description: `${name} gets it on its next turn. If it is idle, send it a message there to start one.` }
    : { title: `Sent to ${name}` };
}

export function openCount(threads: readonly CommentThread[]): number {
  return threads.filter((t) => t.status === 'open').length;
}

export function openMessageCount(threads: readonly CommentThread[]): number {
  return threads.reduce((sum, t) => (t.status === 'open' ? sum + t.messages.length : sum), 0);
}

/** The default note of a card whose anchor moved away. */
function defaultStateNote(state: AnchorState | undefined): string | null {
  if (state === 'detached') return 'What this was on is gone; shown on what held it.';
  if (state === 'orphaned') return 'What this was on has been deleted.';
  return null;
}

/** Creates an editor's comments controller. */
export function createComments<A>(adapter: CommentsAdapter<A>): CommentsController<A> {
  const maxThreads = adapter.maxThreads ?? 500;
  const noun = adapter.noun ?? 'document';
  const notify = (message: { title: string; description?: string }): void => adapter.notify?.(message);
  let capability: CommentsCapability | null = null;
  let unfollow: (() => void) | undefined;
  /** Bumped by {@link CommentsController.stop}: a list arriving after it is dropped. */
  let generation = 0;

  const store = create<CommentsState<A>>()((set) => ({
    available: false,
    threads: [],
    on: false,
    listOpen: false,
    active: null,
    draft: null,
    showResolved: false,
    sendNew: false,
    draftText: '',
    replies: {},
    statusChange: null,
    setOn(on) {
      set({ on, draft: null });
      adapter.onModeChange?.(on);
    },
    setListOpen(listOpen) {
      set({ listOpen });
    },
    setActive(active) {
      set({ active, draft: null });
    },
    setDraft(draft) {
      // Dropped: its text and box go too. Moved to another spot: they stay.
      set(draft === null ? { draft, active: null, draftText: '', sendNew: false } : { draft, active: null });
    },
    setShowResolved(showResolved) {
      set({ showResolved });
    },
    setSendNew(sendNew) {
      set({ sendNew });
    },
    setDraftText(draftText) {
      set({ draftText });
    },
    setReply(id, reply) {
      set((state) => ({ replies: { ...state.replies, [id]: reply } }));
    },
  }));

  /** Anchors parsed once per stored string. */
  const parsed = new Map<string, A>();
  const anchorOf = (thread: Pick<CommentThread, 'anchor'>): A => {
    let anchor = parsed.get(thread.anchor);
    if (anchor === undefined) {
      anchor = adapter.parse(thread.anchor);
      if (parsed.size > 2000) parsed.clear();
      parsed.set(thread.anchor, anchor);
    }
    return anchor;
  };

  /** The threads as the host last told them, without an unconfirmed status change. */
  let stored: CommentThread[] = [];
  const keep = (threads: CommentThread[], also?: Partial<CommentsState<A>>): void => {
    stored = threads;
    const statusChange = also && 'statusChange' in also ? (also.statusChange ?? null) : store.getState().statusChange;
    store.setState({ ...also, threads: withStatusChange(threads, statusChange) });
  };

  const failed = (error: unknown): void => {
    notify({ title: 'The comment could not be saved', description: error instanceof Error ? error.message : String(error) });
  };
  const put = (thread: CommentThread): void => {
    keep(stored.map((t) => (t.id === thread.id ? thread : t)));
    adapter.heard?.([thread]);
  };
  const checkText = (text: string): string | undefined => {
    if (adapter.checkText) return adapter.checkText(text);
    return text.trim().slice(0, COMMENT_TEXT_MAX) || undefined;
  };
  const canComment = (): boolean => Boolean(capability) && adapter.canComment();
  const canSendToAgent = (): boolean => Boolean(capability) && adapter.canSendToAgent();
  const canRemove = (): boolean => Boolean(capability) && (adapter.canRemove ? adapter.canRemove() : adapter.canComment());

  const controller: CommentsController<A> = {
    store,
    adapter,
    async start(found, open) {
      if (!found) return;
      capability = found;
      const started = generation;
      store.setState({ available: true });
      try {
        const threads = await found.list();
        if (started !== generation) return;
        keep(threads);
        adapter.heard?.(threads);
      } catch {
        // The list arrives with the first change.
      }
      if (started !== generation) return;
      unfollow = found.onChange((threads) => {
        const active = store.getState().active;
        keep(threads, { active: active && threads.some((t) => t.id === active) ? active : null });
        adapter.heard?.(threads);
      });
      const thread = open ? store.getState().threads.find((t) => t.id === open) : undefined;
      if (thread) controller.reveal(thread);
    },
    stop() {
      generation += 1;
      unfollow?.();
      unfollow = undefined;
    },
    capability: () => capability,
    canComment,
    canSendToAgent,
    canRemove,
    anchorOf,
    labelOf: (anchor) => adapter.label(anchor),
    stateOf: (anchor) => adapter.state?.(anchor) ?? 'ok',
    stateNote: (state) => (adapter.stateNote ? adapter.stateNote(state ?? 'ok') : defaultStateNote(state)),
    async create(anchor, text, options) {
      if (!capability) return false;
      const body = checkText(text);
      if (!body) return false;
      if (store.getState().threads.length >= maxThreads) {
        notify({ title: `This ${noun} already has ${maxThreads} comments` });
        return false;
      }
      try {
        const detail = adapter.detail?.(anchor);
        const thread = await capability.create({
          anchor: adapter.serialize(anchor),
          label: adapter.label(anchor),
          ...(detail !== undefined ? { detail } : {}),
          location: adapter.location?.(anchor) ?? {},
          text: body,
        });
        const sends = Boolean(options?.send) && canSendToAgent();
        keep(stored.some((t) => t.id === thread.id) ? stored : [...stored, thread], {
          draft: null,
          draftText: '',
          sendNew: false,
          active: adapter.opensCreated?.(sends) === false ? null : thread.id,
        });
        adapter.heard?.([thread]);
        if (sends) await controller.sendToAgent(thread.id);
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    async reply(id, text, options) {
      if (!capability) return false;
      const body = checkText(text);
      if (!body) return false;
      try {
        let thread = await capability.reply(id, body);
        // A reply to a resolved thread reopens it.
        if (thread.status === 'resolved') thread = await capability.setResolved(id, false);
        put(thread);
        store.setState((state) => {
          const { [id]: _, ...replies } = state.replies;
          return { replies };
        });
        if (options?.send && canSendToAgent()) await controller.sendToAgent(id);
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    async resolve(id, resolved) {
      if (!capability) return;
      const state = store.getState();
      const status = resolved ? 'resolved' : 'open';
      const thread = state.threads.find((t) => t.id === id);
      if (!thread || state.statusChange || thread.status === status) return;
      const closes = resolved && state.active === id && !state.showResolved;
      keep(stored, { statusChange: { id, status }, ...(closes ? { active: null } : {}) });
      try {
        const answer = await capability.setResolved(id, resolved);
        // Only the status is taken from the answer: a change heard meanwhile may be newer in everything else.
        keep(
          stored.map((t) => (t.id === id ? withStatus(t, answer.status, answer.resolvedBy) : t)),
          { statusChange: null },
        );
        adapter.heard?.([answer]);
      } catch (error) {
        keep(stored, { statusChange: null });
        failed(error);
        const now = store.getState();
        if (closes && now.active === null && now.draft === null && stored.some((t) => t.id === id)) store.setState({ active: id });
      }
    },
    async remove(id, messageId) {
      if (!capability || (adapter.canRemove && !adapter.canRemove())) return;
      try {
        await capability.remove(id, messageId);
        if (!messageId) keep(stored.filter((t) => t.id !== id), { active: store.getState().active === id ? null : store.getState().active });
      } catch (error) {
        failed(error);
      }
    },
    async move(id, anchor) {
      if (!capability) return;
      try {
        put(await capability.move(id, adapter.serialize(anchor), adapter.location?.(anchor)));
      } catch (error) {
        failed(error);
      }
    },
    async sendToAgent(id) {
      if (!capability || !canSendToAgent()) return false;
      const thread = adapter.sendToAgent ? store.getState().threads.find((t) => t.id === id) : undefined;
      if (adapter.sendToAgent) return thread ? adapter.sendToAgent(thread, anchorOf(thread)) : false;
      try {
        put(await capability.sendToAgent(id));
        notify(sentNotice(adapter.agentName?.() || 'the agent', adapter.agentWakesIdle?.()));
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    async sendAllToAgent() {
      if (!capability || !canSendToAgent()) return;
      const open = store.getState().threads.filter((t) => controller.canSendThread(t));
      if (!open.length) return;
      // All at once: the host merges what reaches it within a short window into one message, so the agent gets
      // every thread in one turn. One after another, each would wait out the window and arrive (or queue) alone.
      if (adapter.sendToAgent) {
        await Promise.all(open.map((thread) => adapter.sendToAgent!(thread, anchorOf(thread))));
        return;
      }
      const cap = capability;
      const results = await Promise.allSettled(open.map((thread) => cap.sendToAgent(thread.id)));
      let sent = 0;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          put(result.value);
          sent++;
        }
      }
      if (sent) notify(sentNotice(adapter.agentName?.() || 'the agent', adapter.agentWakesIdle?.()));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) failed(failure.reason);
    },
    canSendThread(thread) {
      if (thread.status !== 'open') return false;
      const last = thread.messages.at(-1);
      if (!last || last.author.kind !== 'person') return false;
      // Not sent yet, or the agent answered and a person wrote since.
      return !thread.agent || thread.agent.status === 'replied';
    },
    reveal(thread) {
      adapter.reveal?.(anchorOf(thread));
      store.getState().setActive(thread.id);
    },
    show(thread) {
      const state = store.getState();
      if (!state.on) state.setOn(true);
      if (thread.status === 'resolved' && !store.getState().showResolved) store.getState().setShowResolved(true);
      controller.reveal(thread);
    },
    viewerName: () => adapter.viewerName?.() || 'You',
  };
  return controller;
}
