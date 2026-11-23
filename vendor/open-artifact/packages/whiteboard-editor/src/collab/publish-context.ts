/**
 * Publishes this viewer's view context (`room.presence({viewContext})`):
 * what they look at, have selected, are editing or dragging, the comment
 * card they have open, the claim key of their latest request and the layout
 * issues in view. The agent reads it to act on "this" and "here".
 *
 * Rebuilt when any input changes, debounced ({@link VIEW_CONTEXT_DEBOUNCE_MS}),
 * deduplicated and kept under {@link MAX_VIEW_CONTEXT_BYTES}. A request
 * flushes it first ({@link flushViewContext}), so the agent never reads a
 * context older than the request.
 */

import { maybeSession } from '../services/session.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures, useMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';
import { effectiveTool, useTool } from '../state/tool.ts';
import { currentClaimKey, useAsks } from './asks.ts';
import { activeCommentPin, useComments } from './comments.ts';
import { useMoving } from './moving.ts';
import { flushPresence, publishPresence } from './presence.ts';
import { buildViewContext, VIEW_CONTEXT_DEBOUNCE_MS, type BoardViewContext } from './view-context.ts';

let lastSent: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

/** Builds the view context from the stores now; `undefined` without a session. */
export function currentViewContext(): BoardViewContext | undefined {
  const session = maybeSession();
  if (!session) return undefined;
  const { board, byId, pending, status } = useBoard.getState();
  const { camera, width, height, insets } = useCamera.getState();
  const selection = useSelection.getState();
  const pin = activeCommentPin();
  return buildViewContext({
    viewer: { id: session.viewer.id, name: session.viewer.name },
    elements: board.content.elements,
    byId,
    measures: currentMeasures(),
    selected: selection.ids,
    editing: selection.editing,
    camera,
    viewport: { w: width, h: height, top: insets.top, bottom: insets.bottom },
    tool: effectiveTool(),
    commentMode: useTool.getState().commentMode,
    ...(pin ? { pin } : {}),
    moving: useMoving.getState().ids,
    claim: currentClaimKey(),
    dirty: pending > 0 || status === 'offline' || status === 'cached',
  });
}

/** Publishes the context when it changed since the last publish. */
function publish(): BoardViewContext | undefined {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (!running) return currentViewContext();
  const context = currentViewContext();
  if (!context) return undefined;
  const json = JSON.stringify(context);
  if (json !== lastSent) {
    lastSent = json;
    publishPresence({ viewContext: context });
  }
  return context;
}

function schedule(): void {
  if (!running || timer !== undefined) return;
  timer = setTimeout(publish, VIEW_CONTEXT_DEBOUNCE_MS);
}

/**
 * Publishes the view context now (skipping the debounce) and sends it at
 * once; returns it, to go along with a request.
 */
export function flushViewContext(): BoardViewContext | undefined {
  const context = publish();
  flushPresence();
  return context;
}

/** Starts publishing the view context; returns a function that stops. */
export function startViewContext(): () => void {
  if (!maybeSession()?.room) return () => {};
  running = true;
  lastSent = null;
  const stops = [
    useSelection.subscribe((state, previous) => {
      if (state.ids !== previous.ids || state.editing !== previous.editing) schedule();
    }),
    useCamera.subscribe((state, previous) => {
      if (state.camera !== previous.camera || state.width !== previous.width || state.height !== previous.height || state.insets !== previous.insets) schedule();
    }),
    useBoard.subscribe((state, previous) => {
      if (state.board !== previous.board || state.pending !== previous.pending || state.status !== previous.status) schedule();
    }),
    useMeasures.subscribe(schedule),
    useTool.subscribe(schedule),
    useComments.subscribe((state, previous) => {
      if (state.active !== previous.active || state.draft !== previous.draft || state.threads !== previous.threads) schedule();
    }),
    useAsks.subscribe((state, previous) => {
      if (state.asks !== previous.asks) schedule();
    }),
    // Moving starts and ends matter at once: the agent must not touch held items.
    useMoving.subscribe(() => void publish()),
  ];
  publish();
  return () => {
    running = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const stop of stops) stop();
    publishPresence({ viewContext: null });
  };
}
