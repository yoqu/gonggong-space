/**
 * Live gestures: other people's drags, resizes, turns, drawn shapes, arrow
 * edits, arrows being drawn and pen strokes, shown on this page while they
 * happen.
 *
 * Saving waits for a pause in editing (the sync engine debounces writes),
 * so a drag would otherwise reach other pages in jumps. While someone
 * gestures, their page tells the room what the gesture looks like now
 * (frames on {@link GESTURE_TOPIC}, see `gesture-wire.ts`); every other
 * page keeps each peer's latest frame as a *hand* (`peer-hands.ts`) and
 * draws the real elements as the frame has them, gliding between frames,
 * until the saved edit lands.
 *
 * Telling (editors only):
 * - a gesture's first frame waits {@link GESTURE_START_DELAY_MS}, so a click
 *   or a quick nudge never sends anything;
 * - later frames go at most every {@link GESTURE_FRAME_MS}
 *   ({@link GESTURE_INK_FRAME_MS} for the pen);
 * - when the pointer lifts, the last frame goes out, the gesture is closed
 *   and the edit is saved at once, so the hand is replaced quickly.
 *
 * Hearing:
 * - a hand with no news for {@link PEER_HAND_STALE_MS} goes (its page
 *   went quiet or away);
 * - a closed hand stays until the board shows what it showed, or for
 *   {@link PEER_HAND_STORED_KEEP_MS} at most; a closed pen stroke or
 *   arrow draft stays until the board next changes (the new element
 *   arriving), or for {@link PEER_HAND_DRAFT_KEEP_MS} at most;
 * - a local edit of an element a hand holds drops that hand, and the
 *   elements of this page's own gesture (or the one it is typing in) are
 *   never drawn from a hand;
 * - hands of at most {@link MAX_PEER_HANDS} peers are kept (the oldest
 *   goes), and a peer that leaves takes its hand along;
 * - elements whose drawn place jumps when a hand goes, or when someone
 *   else's edit arrives, glide into place (`peer-hands.ts`).
 */

import { create } from 'zustand';
import type { JsonValue, RoomCapability } from '@open-artifact/runtime';
import type { BoardElement, InkColor } from '@open-artifact/whiteboard-core';
import { canEditBoard } from '../services/actions.ts';
import { maybeSession } from '../services/session.ts';
import { flushSync } from '../services/sync.ts';
import { onLocalChange, onRemoteChange, useBoard } from '../state/board.ts';
import { useSelection } from '../state/selection.ts';
import { setShown, useShown } from '../state/shown.ts';
import { onInkTrail, useInteraction } from '../selection/store.ts';
import { useCollabPeers } from './peers.ts';
import {
  GESTURE_TOPIC,
  createGestureAssembler,
  encodeGestureFrame,
  frameLanded,
  readGestureMessage,
  type GestureFrame,
  type WirePoint,
} from './gesture-wire.ts';
import { PEER_GLIDE_MS, glideStart, handGliding, handIds, handsOverrides, sameOverrides, settleGlides, type PeerHand } from './peer-hands.ts';

/** How long a gesture runs before its first frame is sent, ms. */
export const GESTURE_START_DELAY_MS = 100;
/** Shortest time between two frames of a gesture, ms. */
export const GESTURE_FRAME_MS = 50;
/** Shortest time between two frames of a pen stroke, ms (they carry every point). */
export const GESTURE_INK_FRAME_MS = 100;

/** Most peers whose hands are kept. */
export const MAX_PEER_HANDS = 8;
/** A hand with no news for this long goes, ms. */
export const PEER_HAND_STALE_MS = 3000;
/** Longest a closed hand waits for its edit to land, ms. */
export const PEER_HAND_STORED_KEEP_MS = 10_000;
/** Longest a closed pen stroke or arrow draft waits for its element, ms. */
export const PEER_HAND_DRAFT_KEEP_MS = 3000;
/** A peer missing from the peer list for this long after its last frame loses its hand, ms. */
const PEER_HAND_LEFT_MS = 1000;
/** How often hands are checked for the time rules, ms. */
const PEER_HAND_SWEEP_MS = 250;

/**
 * Coalesce-key kinds of the edits that are told live (see `gestureKey`):
 * dragging and Alt-dragging elements, resizing, turning, moving arrow ends
 * and legs, drawing a shape and placing a sticker.
 */
const TOLD_KINDS: ReadonlySet<string> = new Set(['move', 'duplicate', 'resize', 'turn', 'arrow-end', 'arrow-leg', 'draw', 'sticker']);

/** Elements of this page's gesture being told (never drawn from a peer's hand). */
let ownIds: ReadonlySet<string> = new Set();
/** Redraws the hands (set while hearing). */
let redrawHands: (() => void) | null = null;

/* ------------------------------------------------------------------------ */
/* Hearing                                                                  */
/* ------------------------------------------------------------------------ */

export type { PeerHand } from './peer-hands.ts';

interface PeerGesturesState {
  /** Hands by peer id, oldest first. */
  hands: ReadonlyMap<string, PeerHand>;
}

const NO_HANDS: ReadonlyMap<string, PeerHand> = new Map();

/** Other people's live gestures. */
export const usePeerGestures = create<PeerGesturesState>()(() => ({ hands: NO_HANDS }));

/** Whether a hand can go now. */
function handDone(hand: PeerHand, now: number): boolean {
  if (hand.endedAt === undefined) return now - hand.heardAt > PEER_HAND_STALE_MS;
  const board = useBoard.getState();
  if (hand.frame.elements.length === 0 && (hand.frame.gone?.length ?? 0) === 0) {
    return board.board.content.elements !== hand.boardAtEnd || now - hand.endedAt > PEER_HAND_DRAFT_KEEP_MS;
  }
  return frameLanded(hand.frame, board.byId) || now - hand.endedAt > PEER_HAND_STORED_KEEP_MS;
}

/** An element as this page draws it now: from a hand, else as stored. */
function drawnElement(id: string): BoardElement | undefined {
  const override = useShown.getState().overrides.get(id);
  return override === undefined ? useBoard.getState().byId.get(id) : (override ?? undefined);
}

/** Hears the room's gesture messages; returns a function that stops. */
function startHearing(room: RoomCapability): () => void {
  const assembler = createGestureAssembler();
  let sweep: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  let glideEnd: ReturnType<typeof setTimeout> | undefined;

  /** What the hands draw at `now`. */
  const overridesAt = (now: number): Map<string, BoardElement | null> => {
    const editing = useSelection.getState().editing?.id;
    return handsOverrides(usePeerGestures.getState().hands.values(), now, (id) => ownIds.has(id) || id === editing);
  };

  /**
   * Draws the hands as they are now. `jumped` names elements whose drawn
   * place may have jumped since `before` had them: those that did glide
   * into place.
   */
  const redraw = (jumped?: Iterable<string>, before: (id: string) => BoardElement | undefined = drawnElement): void => {
    const { hands } = usePeerGestures.getState();
    const now = performance.now();
    const current = useShown.getState().overrides;
    const computed = overridesAt(now);
    const overrides = sameOverrides(computed, current) ? current : computed;
    let glides = undefined;
    if (jumped !== undefined) {
      const held = new Set<string>();
      for (const hand of hands.values()) for (const id of handIds(hand)) held.add(id);
      const { byId } = useBoard.getState();
      const after = (id: string): BoardElement | undefined => {
        const override = overrides.get(id);
        return override === undefined ? byId.get(id) : (override ?? undefined);
      };
      glides = settleGlides(jumped, before, after, held);
    }
    setShown(overrides, glides);
    if ([...hands.values()].some((hand) => handGliding(hand, now))) {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        redraw();
      });
      // Frames may be held back (a covered window): the glide still ends on time.
      if (glideEnd !== undefined) clearTimeout(glideEnd);
      glideEnd = setTimeout(() => {
        glideEnd = undefined;
        redraw();
      }, PEER_GLIDE_MS);
    }
  };
  redrawHands = () => redraw();

  /** Replaces the hands; those that went glide their elements into place. */
  const setHands = (next: Map<string, PeerHand>, extraJumped: Iterable<string> = [], before: (id: string) => BoardElement | undefined = drawnElement): void => {
    const previous = usePeerGestures.getState().hands;
    const jumped = new Set(extraJumped);
    for (const [peer, hand] of previous) if (next.get(peer) !== hand) for (const id of handIds(hand)) jumped.add(id);
    // Read where things were drawn before the hands change.
    const drawnBefore = new Map([...jumped].map((id) => [id, before(id)] as const));
    usePeerGestures.setState({ hands: next.size === 0 ? NO_HANDS : next });
    redraw(jumped, (id) => drawnBefore.get(id));
    if (next.size > 0) keepSweeping();
  };

  /** The hands without those that are done (and of peers that left). */
  const sweptHands = (): Map<string, PeerHand> => {
    const { hands } = usePeerGestures.getState();
    const now = Date.now();
    const peers = useCollabPeers.getState().peers;
    const next = new Map(hands);
    for (const [peer, hand] of hands) {
      const left = !peers.has(peer) && now - hand.heardAt > PEER_HAND_LEFT_MS;
      if (left || handDone(hand, now)) next.delete(peer);
    }
    return next;
  };

  /** Drops hands that are done; returns whether any remain. */
  const sweepHands = (): boolean => {
    const { hands } = usePeerGestures.getState();
    if (hands.size === 0) return false;
    const next = sweptHands();
    if (next.size !== hands.size) setHands(next);
    return next.size > 0;
  };

  const keepSweeping = (): void => {
    if (sweep !== undefined) return;
    sweep = setInterval(() => {
      if (sweepHands()) return;
      clearInterval(sweep);
      sweep = undefined;
    }, PEER_HAND_SWEEP_MS);
  };

  const offMessages = room.onMessage(({ from, topic, data }) => {
    if (topic !== GESTURE_TOPIC) return;
    const message = readGestureMessage(data);
    if (message === undefined) return;
    const heard = assembler.hear(from, message);
    if (heard === undefined) return;
    const now = Date.now();
    const hands = new Map(usePeerGestures.getState().hands);
    if (heard.kind === 'frame') {
      // The glide starts where the elements are due now (the last glide may not have been drawn
      // to its end); a hidden page draws no frames, so it does not ease.
      const due = overridesAt(performance.now());
      const dueElement = (id: string): BoardElement | undefined => {
        const override = due.get(id);
        return override === undefined ? useBoard.getState().byId.get(id) : (override ?? undefined);
      };
      const start = document.visibilityState === 'hidden' ? new Map<string, BoardElement>() : glideStart(heard.frame, dueElement);
      const hand: PeerHand = { peer: from, n: heard.n, frame: heard.frame, heardAt: now, from: start, glideAt: performance.now() };
      hands.delete(from);
      hands.set(from, hand);
      for (const peer of hands.keys()) {
        if (hands.size <= MAX_PEER_HANDS) break;
        hands.delete(peer);
      }
    } else {
      const hand = hands.get(from);
      if (hand === undefined || hand.n !== heard.n || hand.endedAt !== undefined) return;
      const ended: PeerHand = { ...hand, endedAt: now, boardAtEnd: useBoard.getState().board.content.elements };
      if (handDone(ended, now)) hands.delete(from);
      else hands.set(from, ended);
    }
    setHands(hands);
  });

  // Someone's edit arriving: their hand lands, and what jumped glides into place.
  const offRemote = onRemoteChange((next, previous) => {
    const before = new Set(previous.content.elements);
    const jumped = next.content.elements.flatMap((element) => (before.has(element) ? [] : [element.id]));
    if (jumped.length === 0 && usePeerGestures.getState().hands.size === 0) return;
    const previousById = new Map(previous.content.elements.map((element) => [element.id, element]));
    const overrides = useShown.getState().overrides;
    const drawnBefore = (id: string): BoardElement | undefined => {
      const override = overrides.get(id);
      return override === undefined ? previousById.get(id) : (override ?? undefined);
    };
    setHands(sweptHands(), jumped, drawnBefore);
  });

  // A local edit of an element a hand holds drops that hand (the edit shows as made).
  const offLocal = onLocalChange((next, previous) => {
    const { hands } = usePeerGestures.getState();
    if (hands.size === 0) return;
    const before = new Set(previous.content.elements);
    const present = new Set(next.content.elements.map((element) => element.id));
    const touched = new Set(next.content.elements.flatMap((element) => (before.has(element) ? [] : [element.id])));
    for (const element of previous.content.elements) if (!present.has(element.id)) touched.add(element.id);
    const kept = new Map([...hands].filter(([, hand]) => !handIds(hand).some((id) => touched.has(id))));
    if (kept.size === hands.size) return;
    usePeerGestures.setState({ hands: kept.size === 0 ? NO_HANDS : kept });
    redraw();
  });

  // The element being typed in is drawn as this page has it.
  const offEditing = useSelection.subscribe((state, previous) => {
    if (state.editing?.id !== previous.editing?.id && usePeerGestures.getState().hands.size > 0) redraw();
  });
  const offPeers = useCollabPeers.subscribe((state, previous) => {
    if (state.peers !== previous.peers) {
      for (const hand of usePeerGestures.getState().hands.values()) if (!state.peers.has(hand.peer)) assembler.forget(hand.peer);
      sweepHands();
    }
  });
  return () => {
    offMessages();
    offRemote();
    offLocal();
    offEditing();
    offPeers();
    if (sweep !== undefined) clearInterval(sweep);
    if (frame !== 0) cancelAnimationFrame(frame);
    if (glideEnd !== undefined) clearTimeout(glideEnd);
    redrawHands = null;
    usePeerGestures.setState({ hands: NO_HANDS });
    setShown(new Map());
  };
}

/* ------------------------------------------------------------------------ */
/* Telling                                                                  */
/* ------------------------------------------------------------------------ */

/** This page's gesture being told. */
interface Telling {
  /** The edit's coalesce key, or `ink` / `draft`. */
  key: string;
  n: number;
  /** Serial of the last frame sent. */
  s: number;
  /** Elements the gesture changed or made. */
  ids: Set<string>;
  /** Elements the gesture took off the board. */
  gone: Set<string>;
  /** The pen stroke being drawn (its points grow in place). */
  ink?: { color: InkColor; width: number; points: readonly number[] };
  /** The arrow being drawn. */
  draft?: { from: WirePoint; to: WirePoint; color: InkColor };
  startedAt: number;
  sentAt: number;
  /** Whether a frame went out (the gesture must be closed). */
  sent: boolean;
  /** Whether something changed since the last frame. */
  dirty: boolean;
}

/** Sets the elements of this page's gesture; a peer's hand holding one is redrawn without it. */
function holdOwn(ids: ReadonlySet<string>): void {
  const changed = ids.size !== ownIds.size || [...ids].some((id) => !ownIds.has(id));
  ownIds = ids;
  if (changed && usePeerGestures.getState().hands.size > 0) redrawHands?.();
}

/** Tells the room about this page's gestures; returns a function that stops. */
function startTelling(room: RoomCapability): () => void {
  let telling: Telling | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let serial = Math.floor(Math.random() * 1_000_000);

  const emit = (payload: object): void => {
    void room.emit(GESTURE_TOPIC, payload as JsonValue).catch(() => {});
  };

  const frameOf = (current: Telling): GestureFrame => {
    const { byId } = useBoard.getState();
    return {
      elements: [...current.ids].flatMap((id) => byId.get(id) ?? []),
      gone: [...current.gone].filter((id) => !byId.has(id)),
      ...(current.ink ? { ink: { color: current.ink.color, width: current.ink.width, points: [...current.ink.points] } } : {}),
      ...(current.draft ? { draft: current.draft } : {}),
    };
  };

  const sendFrame = (): void => {
    timer = undefined;
    const current = telling;
    if (current === null || !current.dirty) return;
    current.dirty = false;
    current.sentAt = performance.now();
    current.s += 1;
    const parts = encodeGestureFrame(current.n, current.s, frameOf(current));
    if (parts === undefined) return;
    current.sent = true;
    for (const part of parts) emit(part);
  };

  const schedule = (): void => {
    const current = telling;
    if (current === null || timer !== undefined) return;
    const gap = current.key === 'ink' ? GESTURE_INK_FRAME_MS : GESTURE_FRAME_MS;
    const due = Math.max(current.startedAt + GESTURE_START_DELAY_MS, current.sentAt + gap);
    timer = setTimeout(sendFrame, Math.max(0, due - performance.now()));
  };

  /** Closes the gesture: the last frame, the end, and an immediate save. */
  const finish = (): void => {
    const current = telling;
    if (current === null) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (current.sent) {
      if (current.dirty) sendFrame();
      emit({ n: current.n, end: 1 });
    }
    telling = null;
    holdOwn(new Set());
    flushSync();
  };

  /** The gesture `key`, started when it is not the one being told. */
  const begin = (key: string): Telling | null => {
    if (telling?.key === key) return telling;
    finish();
    if (!canEditBoard()) return null;
    serial += 1;
    const now = performance.now();
    telling = { key, n: serial, s: 0, ids: new Set(), gone: new Set(), startedAt: now, sentAt: 0, sent: false, dirty: false };
    return telling;
  };

  const offChanges = onLocalChange((next, previous, options) => {
    const key = options.coalesce;
    const kind = key?.slice(0, key.indexOf(':'));
    if (key === undefined || kind === undefined || !TOLD_KINDS.has(kind)) return;
    const current = begin(key);
    if (current === null) return;
    const before = new Set(previous.content.elements);
    const present = new Set<string>();
    for (const element of next.content.elements) {
      present.add(element.id);
      if (!before.has(element)) {
        current.ids.add(element.id);
        current.gone.delete(element.id);
      }
    }
    for (const element of previous.content.elements) {
      if (present.has(element.id)) continue;
      current.ids.delete(element.id);
      current.gone.add(element.id);
    }
    holdOwn(new Set([...current.ids, ...current.gone]));
    current.dirty = true;
    schedule();
  });

  const offInk = onInkTrail((points) => {
    if (points === null) {
      if (telling?.key === 'ink') setTimeout(finish, 0);
      return;
    }
    const look = useInteraction.getState().ink;
    const current = look ? begin('ink') : null;
    if (current === null || look === null) return;
    current.ink = { color: look.color, width: look.width, points };
    current.dirty = true;
    schedule();
  });

  const offDraft = useInteraction.subscribe((state, previous) => {
    const draft = state.arrowDraft;
    if (draft === previous.arrowDraft) return;
    if (draft === null) {
      if (telling?.key === 'draft') setTimeout(finish, 0);
      return;
    }
    const current = begin('draft');
    if (current === null) return;
    current.draft = { from: [draft.from.x, draft.from.y], to: [draft.to.x, draft.to.y], color: draft.color };
    current.dirty = true;
    schedule();
  });

  // Lifting the pointer closes an edit gesture once the tool's own pointer-up ran.
  const onUp = (): void => {
    if (telling !== null && telling.key !== 'ink' && telling.key !== 'draft') setTimeout(finish, 0);
  };
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') finish();
  };
  window.addEventListener('pointerup', onUp, { capture: true });
  window.addEventListener('pointercancel', onUp, { capture: true });
  document.addEventListener('visibilitychange', onHidden);

  return () => {
    finish();
    offChanges();
    offInk();
    offDraft();
    window.removeEventListener('pointerup', onUp, { capture: true });
    window.removeEventListener('pointercancel', onUp, { capture: true });
    document.removeEventListener('visibilitychange', onHidden);
  };
}

/**
 * Starts live gestures (telling and hearing); a no-op without a room.
 * Returns a function that stops.
 */
export function startLiveGestures(): () => void {
  const room = maybeSession()?.room;
  if (!room) return () => {};
  const stopHearing = startHearing(room);
  const stopTelling = startTelling(room);
  return () => {
    stopTelling();
    stopHearing();
  };
}
