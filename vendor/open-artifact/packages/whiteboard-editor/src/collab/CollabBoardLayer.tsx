/**
 * Collaboration drawings in board units, inside the camera layer: the
 * agent's claim frames, other people's selections, the pen strokes and
 * arrows they are drawing (`PeerSketches`), outlines previewing an idea's
 * option, the area being picked to ask about, areas of comments, the
 * marks of requests in flight and the area the Ask panel is about.
 *
 * One SVG that never takes pointer events; strokes keep their screen width
 * at any zoom (`vector-effect: non-scaling-stroke`).
 */

import { useMemo } from 'react';
import { CLAIM_FADE_MS, elementBounds, unionBounds, type BoardElement, type Box, type ElementMeasures } from '@open-artifact/whiteboard-core';
import { useAsk } from '../state/ask.ts';
import { useBoard } from '../state/board.ts';
import { useMeasures } from '../state/measures.ts';
import { useShownById } from '../state/shown.ts';
import { visibleAskMarks, type AskMark } from './ask-marks.ts';
import { isAskPending } from './ask-status.ts';
import { useAsks } from './asks.ts';
import { anchorPlace, isCommentDraft, useCommentDrag, useComments } from './comments.ts';
import { useClaimViews, useFading, useMyColor } from './hooks.ts';
import { previewIdeaVersion } from './idea-edits.ts';
import { useIdea } from './ideas.ts';
import { useCollabPeers } from './peers.ts';
import { PeerSketches } from './PeerSketches.tsx';

/** Most elements of one peer's selection drawn. */
const MAX_PEER_RINGS = 60;

/** Most items a request's mark is fitted around (as many as a request names). */
const MAX_MARKED_ITEMS = 50;

/** Gap between an element and a peer's selection ring (board units). */
const RING_GAP = 4;

function Rect({ box, className, color, pad = 0, radius = 8 }: { box: Box; className: string; color?: string; pad?: number; radius?: number }) {
  return (
    <rect
      className={className}
      x={box.x - pad}
      y={box.y - pad}
      width={Math.max(0, box.w + 2 * pad)}
      height={Math.max(0, box.h + 2 * pad)}
      rx={radius}
      vectorEffect="non-scaling-stroke"
      style={color ? { stroke: color, fill: color } : undefined}
    />
  );
}

function boundsOf(ids: readonly string[], byId: ReadonlyMap<string, BoardElement>, measures: ElementMeasures, limit: number): Box[] {
  const boxes: Box[] = [];
  for (const id of ids.slice(0, limit)) {
    const element = byId.get(id);
    const box = element ? elementBounds(element, measures) : undefined;
    if (box) boxes.push(box);
  }
  return boxes;
}

/** Claim frames, fading out when the agent lets go. */
function ClaimFrames() {
  const claims = useFading(useClaimViews(), CLAIM_FADE_MS);
  return (
    <>
      {claims.map((claim) => (
        <g key={claim.key} className="wb-claim" data-leaving={claim.leaving ? '' : undefined}>
          <Rect box={claim.frame} className="wb-claim-fill" color={claim.color} radius={12} />
          <Rect box={claim.frame} className="wb-claim-edge" color={claim.color} radius={12} />
        </g>
      ))}
    </>
  );
}

/** Other people's selections, in their colors (following what they drag, see `state/shown.ts`). */
function PeerSelections() {
  const peers = useCollabPeers((state) => state.peers);
  const byId = useShownById();
  const measures = useMeasures((state) => state.measures);
  return (
    <>
      {[...peers.values()].map((peer) =>
        boundsOf(peer.selection, byId, measures, MAX_PEER_RINGS).map((box, index) => (
          <Rect key={`${peer.id}:${index}`} box={box} className="wb-peer-ring" color={peer.color} pad={RING_GAP} radius={6} />
        )),
      )}
    </>
  );
}

/** Outlines of what the hovered idea option would add, change or remove. */
function IdeaPreview() {
  const idea = useIdea((state) => state.idea);
  const hover = useIdea((state) => state.hover);
  const applied = useIdea((state) => state.applied);
  const elements = useBoard((state) => state.board.content.elements);
  const measures = useMeasures((state) => state.measures);
  const preview = useMemo(() => {
    const version = hover === null ? undefined : idea?.options[hover]?.version;
    if (!idea || !version || (hover !== null && applied.has(hover))) return undefined;
    return previewIdeaVersion(elements, version, idea.read ?? []);
  }, [idea, hover, applied, elements, measures]);
  if (!preview) return null;
  const draw = (list: readonly BoardElement[], kind: string) =>
    list.flatMap((element) => {
      const box = elementBounds(element, measures);
      return box ? [<Rect key={`${kind}:${element.id}`} box={box} className={`wb-idea-outline wb-idea-${kind}`} pad={4} radius={6} />] : [];
    });
  return (
    <>
      {draw(preview.removed, 'removed')}
      {draw(preview.changed, 'changed')}
      {draw(preview.added, 'added')}
    </>
  );
}

/**
 * Marks of requests in flight, this page's and those others share, on their
 * area or selection, until the agent frames a claim there
 * (`ask-marks.ts`); and the area the Ask panel is about while it is open.
 */
function AskAreas() {
  const asks = useAsks((state) => state.asks);
  const peers = useCollabPeers((state) => state.peers);
  const panelOpen = useAsk((state) => state.open);
  const scope = useAsk((state) => state.scope);
  const byId = useShownById();
  const measures = useMeasures((state) => state.measures);
  const claims = useClaimViews();
  const myColor = useMyColor();
  const marks: AskMark[] = [];
  const mark = (key: string, claimKey: string, color: string, rect: Box | undefined, ids: readonly string[] | undefined): void => {
    const box = rect ?? (ids && ids.length > 0 ? unionBounds(boundsOf(ids, byId, measures, MAX_MARKED_ITEMS)) : undefined);
    if (box) marks.push({ key, claimKey, box, color });
  };
  for (const ask of asks.values()) {
    if (!isAskPending(ask.status)) continue;
    if (ask.target.kind === 'area') mark(ask.key, ask.key, myColor, ask.target.rect, undefined);
    else if (ask.target.kind === 'selection') mark(ask.key, ask.key, myColor, undefined, ask.target.ids);
  }
  for (const peer of peers.values()) {
    for (const ask of peer.asks) if (isAskPending(ask.status)) mark(`${peer.id}:${ask.key}`, ask.key, peer.color, ask.rect, ask.ids);
  }
  const scopeArea = panelOpen && scope.kind === 'area' ? scope.rect : undefined;
  return (
    <>
      {visibleAskMarks(marks, claims).map((area) => (
        <Rect key={area.key} box={area.box} className="wb-ask-area" color={area.color} radius={8} />
      ))}
      {scopeArea ? <Rect box={scopeArea} className="wb-ask-area wb-ask-scope" color={myColor} radius={8} /> : null}
    </>
  );
}

/** The comment area being dragged, the area of the open comment, and in comment mode the element a click comments on. */
function CommentAreas() {
  const dragging = useCommentDrag((state) => state.dragging);
  const hover = useCommentDrag((state) => state.hover);
  const active = useComments((state) => state.active);
  const draft = useComments((state) => state.draft);
  const threads = useComments((state) => state.threads);
  const elements = useBoard((state) => state.board.content.elements);
  const measures = useMeasures((state) => state.measures);
  const thread = active ? threads.find((other) => other.id === active) : undefined;
  const activeRect = thread ? anchorPlace(thread.anchor, elements, measures)?.rect : undefined;
  const draftRect = draft && isCommentDraft(draft) && 'w' in draft.at ? draft.at : undefined;
  const rect = dragging ?? draftRect ?? activeRect;
  // Nothing outlined under the pointer while a card or the composer is open (a click there only closes it).
  const outline = !dragging && draft === null && !active ? hover : null;
  return (
    <>
      {outline ? <Rect box={outline} className="wb-comment-hover" radius={2} /> : null}
      {rect ? <Rect box={rect} className="wb-comment-area" radius={4} /> : null}
    </>
  );
}

/** Collaboration drawings in board units (place inside the camera layer). */
export function CollabBoardLayer() {
  return (
    <svg className="wb-collab-board" aria-hidden="true" width="1" height="1" overflow="visible">
      <PeerSelections />
      <PeerSketches />
      <ClaimFrames />
      <AskAreas />
      <IdeaPreview />
      <CommentAreas />
    </svg>
  );
}
