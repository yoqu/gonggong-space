/**
 * Comment pins on the board (screen units), their cards and the composer of
 * a new comment: the editor kit's (`CommentPins`, CommentViews.tsx), the same
 * as every other editor's, placed with the board's anchors. A pin can be
 * dragged to re-anchor its thread.
 *
 * The kit's views stop React's events; the board listens natively, so they
 * sit in a `data-wb-chrome` wrapper, which the board's gestures skip.
 *
 * Comment text, labels and author names are untrusted: rendered as text.
 */

import { useCallback, useMemo } from 'react';
import type { CommentThread } from '@open-artifact/runtime';
import { elementBounds } from '@open-artifact/whiteboard-core';
import { CommentPins as SharedPins, type AgentBadge } from '@open-artifact/editor-kit/react';
import type { Box, Camera, PinPlace, Point } from '@open-artifact/editor-kit';
import { useAgent } from '../services/agent.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useMeasures } from '../state/measures.ts';
import { anchorPlace, boardComments, isCommentDraft, pointCommentDraft, type BoardAnchor } from './comments.ts';

/** What the agent has done with a thread, in words. */
export function agentStateLabel(thread: CommentThread): string | undefined {
  switch (thread.agent?.status) {
    case 'pending':
      return 'Sent to the agent';
    case 'delivered':
      return 'The agent has it';
    case 'replied':
      return 'The agent replied';
    default:
      return undefined;
  }
}

/** The agent as the comment cards show it. */
export function useAgentBadge(): AgentBadge {
  const available = useAgent((state) => state.available);
  const name = useAgent((state) => state.name);
  const wakesIdle = useAgent((state) => state.wakesIdle);
  return useMemo(() => ({ available, name, wakesIdle }), [available, name, wakesIdle]);
}

/** Every comment pin in view, the open card and the composer. */
export function CommentPins() {
  const elements = useBoard((state) => state.board.content.elements);
  const measures = useMeasures((state) => state.measures);
  const board = useCamera((state) => state.camera);
  const width = useCamera((state) => state.width);
  const height = useCamera((state) => state.height);
  const agent = useAgentBadge();
  // The board's camera names the board point at the top-left (screen = (board - camera) × zoom); the kit's is an offset.
  const camera = useMemo((): Camera => ({ x: -board.x * board.zoom, y: -board.y * board.zoom, zoom: board.zoom }), [board]);
  const viewport = useMemo(() => ({ width, height }), [width, height]);

  const place = useCallback(
    (anchor: BoardAnchor): PinPlace | null => {
      // A comment being written sits where it was clicked (an area's top-right corner).
      if (isCommentDraft(anchor)) return { world: 'w' in anchor.at ? { x: anchor.at.x + anchor.at.w, y: anchor.at.y } : anchor.at, state: 'ok' };
      const at = anchorPlace(anchor.anchor, elements, measures, board.zoom);
      return at ? { world: at.point, state: 'ok' } : null;
    },
    [elements, measures, board.zoom],
  );
  // The open comment's element is outlined (an area's box is drawn on the board: CollabBoardLayer.tsx).
  const highlight = useCallback(
    (anchor: BoardAnchor): Box | null => {
      if (isCommentDraft(anchor) && 'w' in anchor.at) return null;
      const at = anchorPlace(anchor.anchor, elements, measures, board.zoom);
      if (!at || at.rect) return null;
      const element = at.id ? elements.find((other) => other.id === at.id) : undefined;
      return (element && elementBounds(element, measures)) ?? null;
    },
    [elements, measures, board.zoom],
  );
  // A dragged pin lands on the element under its tip, at that point.
  const anchorAt = useCallback((world: Point): BoardAnchor => pointCommentDraft(world, elements, measures, board.zoom), [elements, measures, board.zoom]);

  return (
    <div data-wb-chrome="" className="contents">
      <SharedPins<BoardAnchor> comments={boardComments} camera={camera} viewport={viewport} place={place} highlight={highlight} anchorAt={anchorAt} agent={agent} />
    </div>
  );
}
