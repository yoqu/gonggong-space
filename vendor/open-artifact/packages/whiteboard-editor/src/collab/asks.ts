/**
 * Requests to the agent made on this board, and where each one stands.
 *
 * Every way of asking ends in {@link askAgent} (the Ask panel and ⌘K, a drag
 * over open ground, cursor chat, a comment sent to the agent). A request
 * gets a claim key; the agent claims ground with that key (`board/claim-
 * <key>`) while it works and deletes the claim when it is done, so the page
 * can show the request as queued, working, done, stopped or failed.
 *
 * Pending requests are shared with the other viewers through presence, so
 * everyone sees whose request a claimed area answers.
 */

import { create } from 'zustand';
import { agentResultMessage } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import type { AgentSendResult, CommentThread, JsonRecord, JsonValue } from '@open-artifact/runtime';
import { boardPointTarget, createClaimKey, elementsWithinBox, type Box } from '@open-artifact/whiteboard-core';
import type { Point, Rect } from '../lib/camera.ts';
import { sendToAgent, useAgent } from '../services/agent.ts';
import { maybeSession } from '../services/session.ts';
import { useBoard } from '../state/board.ts';
import { currentMeasures } from '../state/measures.ts';
import {
  ASK_FADE_MS,
  ASK_LINGER_MS,
  MAX_ASK_TEXT,
  MAX_SHARED_ASK_TEXT,
  SHARED_ASK_REBROADCAST_MS,
  askStatusAfterClaims,
  askStatusAfterIdle,
  askStatusAfterSend,
  isAskPending,
  isAskSettled,
  type AskStatus,
} from './ask-status.ts';
import { askActivity } from './activity-labels.ts';
import type { SharedAsk } from './peers.ts';
import { publishPresence } from './presence.ts';
import { flushViewContext } from './publish-context.ts';
import { viewContextItem } from './view-context.ts';

/** What a request is about. */
export type AskTarget =
  /** The whole board (what the viewer sees is in the view context). */
  | { kind: 'board' }
  /** Selected elements. */
  | { kind: 'selection'; ids: string[] }
  /** An area dragged on the board (board units). */
  | { kind: 'area'; rect: Rect }
  /** A point on the board (cursor chat). */
  | { kind: 'point'; point: Point };

/** Where a request was made. */
export type AskVia = 'panel' | 'area' | 'cursor-chat' | 'comment';

/** A request made from this page. */
export interface LocalAsk {
  /** The claim key. */
  key: string;
  /** The person's words. */
  text: string;
  target: AskTarget;
  via: AskVia;
  status: AskStatus;
  /** When it was made (epoch ms). */
  at: number;
  /** When it settled (done, stopped or failed). */
  settledAt?: number;
  /** Fading out, about to be forgotten. */
  fading?: boolean;
  /** What the agent is doing for it ("Adding"), from the request's words. */
  activity?: string;
  /** The comment thread it was sent from. */
  thread?: string;
}

interface AsksState {
  asks: ReadonlyMap<string, LocalAsk>;
  /**
   * The claim key the view context offers when no board request is pending
   * (a request typed in the conversation still gets a frame in this
   * viewer's color).
   */
  tabKey: string;
}

/** This page's requests, by claim key. */
export const useAsks = create<AsksState>()(() => ({ asks: new Map(), tabKey: createClaimKey() }));

/** The claim key the agent should use now: the latest pending request's, else this tab's. */
export function currentClaimKey(state: AsksState = useAsks.getState()): string {
  let latest: LocalAsk | undefined;
  for (const ask of state.asks.values()) if (isAskPending(ask.status) && (latest === undefined || ask.at >= latest.at)) latest = ask;
  return latest?.key ?? state.tabKey;
}

function patchAsk(key: string, patch: Partial<LocalAsk>): void {
  useAsks.setState((state) => {
    const ask = state.asks.get(key);
    if (!ask) return state;
    const next = { ...ask, ...patch };
    if (patch.status !== undefined && isAskSettled(patch.status) && !isAskSettled(ask.status)) next.settledAt = Date.now();
    const asks = new Map(state.asks);
    asks.set(key, next);
    return { asks };
  });
}

function addAsk(ask: LocalAsk): void {
  useAsks.setState((state) => {
    const asks = new Map(state.asks);
    asks.set(ask.key, ask);
    return { asks };
  });
}

const sentListeners = new Set<(ask: LocalAsk) => void>();

/** Calls `listener` after each request is handed to the host; returns an unsubscribe function. */
export function onAskSent(listener: (ask: LocalAsk) => void): () => void {
  sentListeners.add(listener);
  return () => void sentListeners.delete(listener);
}

function roundRect(rect: Box): JsonRecord {
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
}

/** The `scope` the agent reads with a request. */
export function askScopeContext(target: AskTarget): JsonRecord {
  const { board, byId } = useBoard.getState();
  const elements = board.content.elements;
  const measures = currentMeasures();
  const labels = (ids: readonly string[]): JsonValue[] =>
    ids
      .slice(0, 5)
      .flatMap((id) => {
        const element = byId.get(id);
        return element ? [viewContextItem(element)] : [];
      })
      .map((item) => ({ ...item }));
  switch (target.kind) {
    case 'board':
      return { kind: 'board' };
    case 'selection': {
      const ids = target.ids.filter((id) => byId.has(id)).slice(0, 50);
      return { kind: 'selection', ids, items: labels(ids) };
    }
    case 'area': {
      const ids = elementsWithinBox(target.rect, elements, measures).slice(0, 50);
      return { kind: 'area', rect: roundRect(target.rect), ids, items: labels(ids) };
    }
    case 'point': {
      const hit = boardPointTarget(target.point.x, target.point.y, elements, measures).selected;
      return { kind: 'point', point: { x: Math.round(target.point.x), y: Math.round(target.point.y) }, ids: hit, items: labels(hit) };
    }
  }
}

/** Tells the person how the host took a request. */
function reportResult(result: AgentSendResult): void {
  toast.add(agentResultMessage(result, 'this board', useAgent.getState()));
}

/** Short titles of requests, by where they were made. */
const ASK_TITLES: Readonly<Record<AskVia, string>> = {
  panel: 'Ask from the board',
  area: 'Ask about an area of the board',
  'cursor-chat': 'Ask from cursor chat',
  comment: 'Comment sent to the agent',
};

/** A request to make. */
export interface AskInput {
  /** The person's words. */
  text: string;
  target: AskTarget;
  via: AskVia;
  /** Text files attached to this request only (`attached-files.ts`). */
  files?: ReadonlyArray<{ name: string; text: string }>;
}

/**
 * Sends a request to the agent: the person's words, what it is about, any
 * attached files and the view context (with the request's claim key).
 * Resolves with the host's answer, or `undefined` when there was nothing
 * to send.
 */
export async function askAgent(input: AskInput): Promise<AgentSendResult | undefined> {
  const text = [...input.text.trim()].slice(0, MAX_ASK_TEXT).join('');
  if (text === '') return undefined;
  const key = createClaimKey();
  const activity = askActivity(text);
  const ask: LocalAsk = { key, text, target: input.target, via: input.via, status: 'sending', at: Date.now(), ...(activity ? { activity } : {}) };
  addAsk(ask);
  const view = flushViewContext();
  const result = await sendToAgent({
    text,
    title: ASK_TITLES[input.via],
    context: {
      action: 'ask',
      scope: askScopeContext(input.target),
      claim: key,
      via: input.via,
      ...(input.files && input.files.length > 0 ? { files: input.files.map((file) => ({ name: file.name, text: file.text })) } : {}),
      ...(view ? { view: view as unknown as JsonRecord } : {}),
    },
  });
  const current = useAsks.getState().asks.get(key);
  // A claim may already have arrived while the send was in flight.
  if (current && current.status === 'sending') patchAsk(key, { status: askStatusAfterSend(result) });
  reportResult(result);
  for (const listener of [...sentListeners]) listener(useAsks.getState().asks.get(key) ?? ask);
  return result;
}

/** The status a comment thread's agent state gives its request. */
function threadAskStatus(thread: CommentThread): AskStatus | undefined {
  switch (thread.agent?.status) {
    case 'pending':
      return 'queued';
    case 'delivered':
      return 'delivered';
    case 'replied':
      return 'done';
    default:
      return undefined;
  }
}

/**
 * Hands a comment thread to the agent through the comments capability (so
 * its answer lands in the thread), tracked like any other request: the
 * thread's claim key is published in the view context before the hand-off.
 */
export async function sendThreadToAgent(thread: CommentThread, target: AskTarget): Promise<boolean> {
  const comments = maybeSession()?.comments;
  if (!comments) return false;
  const text = thread.messages.map((message) => message.text).join('\n');
  const key = createClaimKey();
  const activity = askActivity(thread.messages[0]?.text ?? '');
  addAsk({ key, text, target, via: 'comment', status: 'sending', at: Date.now(), thread: thread.id, ...(activity ? { activity } : {}) });
  flushViewContext();
  try {
    const sent = await comments.sendToAgent(thread.id);
    noteThreadChanged(sent);
    if (useAsks.getState().asks.get(key)?.status === 'sending') patchAsk(key, { status: threadAskStatus(sent) ?? 'queued' });
    toast.add(agentResultMessage({ status: sent.agent?.status === 'delivered' ? 'delivered' : 'queued' }, 'this board', useAgent.getState()));
    const ask = useAsks.getState().asks.get(key);
    if (ask) for (const listener of [...sentListeners]) listener(ask);
    return true;
  } catch (error) {
    patchAsk(key, { status: 'failed' });
    toast.add({ title: 'Could not reach the agent', description: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Follows a thread's agent state into the request sent from it. */
export function noteThreadChanged(thread: CommentThread): void {
  const status = threadAskStatus(thread);
  if (status === undefined) return;
  for (const ask of useAsks.getState().asks.values()) {
    if (ask.thread !== thread.id || isAskSettled(ask.status)) continue;
    // A claim is the better signal once the agent works on the board.
    if (ask.status === 'working' && status !== 'done') continue;
    if (ask.status !== status) patchAsk(ask.key, { status });
  }
}

const expiredKeys = new Set<string>();

/** Notes claims dropped because they expired (their requests end as stopped). */
export function noteExpiredClaims(keys: readonly string[]): void {
  for (const key of keys) expiredKeys.add(key);
}

/** The requests this page shares with others. */
export function sharedAsks(asks: Iterable<LocalAsk>): SharedAsk[] {
  const shared: SharedAsk[] = [];
  for (const ask of asks) {
    if (ask.fading) continue;
    const text = [...ask.text.replace(/\s+/g, ' ').trim()].slice(0, MAX_SHARED_ASK_TEXT).join('');
    shared.push({
      key: ask.key,
      status: ask.status,
      ...(text ? { text } : {}),
      ...(ask.target.kind === 'area' ? { rect: ask.target.rect } : {}),
      ...(ask.target.kind === 'point' ? { point: ask.target.point } : {}),
      ...(ask.target.kind === 'selection' ? { ids: ask.target.ids.slice(0, 50) } : {}),
    });
  }
  return shared.slice(-8);
}

/**
 * Starts tracking requests: their status from the board's claims and the
 * agent's state, forgetting settled ones, and sharing pending ones.
 */
export function startAsks(): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (key: string, ms: number, run: () => void): void => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        run();
      }, ms),
    );
  };

  // Claims move requests along.
  const syncClaims = (): void => {
    const claimed = new Set((useBoard.getState().board.content.claimed ?? []).map((claim) => claim.key));
    for (const ask of useAsks.getState().asks.values()) {
      const next = askStatusAfterClaims(ask.status, claimed.has(ask.key), expiredKeys.has(ask.key));
      if (next !== ask.status) patchAsk(ask.key, { status: next });
    }
    for (const key of [...expiredKeys]) if (!claimed.has(key)) expiredKeys.delete(key);
  };
  const offBoard = useBoard.subscribe((state, previous) => {
    if (state.board.content.claimed !== previous.board.content.claimed) syncClaims();
  });

  // The agent going idle settles what it had in hand without claiming.
  let busySince = useAgent.getState().busy ? Date.now() : 0;
  const offAgent = useAgent.subscribe((state, previous) => {
    if (state.busy && !previous.busy) busySince = Date.now();
    if (!state.busy && previous.busy) {
      const claimed = new Set((useBoard.getState().board.content.claimed ?? []).map((claim) => claim.key));
      for (const ask of useAsks.getState().asks.values()) {
        if (ask.at > busySince) continue;
        const next = askStatusAfterIdle(ask.status, claimed.has(ask.key));
        if (next !== ask.status) patchAsk(ask.key, { status: next });
      }
    }
  });

  // Settled requests linger, fade, then go; changes are shared.
  let lastShared = '';
  const share = (): void => {
    const list = sharedAsks(useAsks.getState().asks.values());
    const json = JSON.stringify(list);
    if (json === lastShared) return;
    lastShared = json;
    publishPresence({ asks: list.length > 0 ? list : null });
  };
  const offAsks = useAsks.subscribe((state, previous) => {
    if (state.asks === previous.asks) return;
    for (const ask of state.asks.values()) {
      if (!isAskSettled(ask.status) || ask.settledAt === undefined || timers.has(ask.key)) continue;
      const fadeIn = Math.max(0, ask.settledAt + ASK_LINGER_MS - Date.now());
      schedule(ask.key, fadeIn, () => {
        patchAsk(ask.key, { fading: true });
        schedule(ask.key, ASK_FADE_MS, () => {
          useAsks.setState((current) => {
            const asks = new Map(current.asks);
            asks.delete(ask.key);
            return { asks };
          });
        });
      });
    }
    share();
  });

  // Pending requests are published again now and then, so late joiners see them.
  const rebroadcast = setInterval(() => {
    if ([...useAsks.getState().asks.values()].some((ask) => isAskPending(ask.status))) {
      lastShared = '';
      share();
    }
  }, SHARED_ASK_REBROADCAST_MS);

  syncClaims();
  return () => {
    offBoard();
    offAgent();
    offAsks();
    clearInterval(rebroadcast);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
