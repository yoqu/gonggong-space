













import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type UIEvent, type WheelEvent } from 'react';
import type { CommentMessage, CommentThread } from '@open-artifact/runtime';
import { Avatar, Button, cn, Icon, Menu, MenuItems, MenuPopup, Tooltip, type MenuItemSpec } from './cds/cds.tsx';
import { Actions, Comment, CommentCard, DeleteConfirm, MoreMenu, Replies, ReplyField, ResolveAction, useLayerMenu, type WorkingState } from './cds/comment-card.tsx';
import { CommentComposer as CdsComposer } from './cds/comment-composer.tsx';
import { EdgePiles, edgePiles, stackPins } from './cds/edge-piles.tsx';
import { CommentsLayer, InLayer } from './cds/layer.tsx';
import { commentMarkdown } from './cds/markdown.tsx';
import { commentTime } from './cds/time.ts';
import { openMessageCount, queuedNote, WAIT_FOR_STATUS_CHANGE, type CommentsController } from './comments.ts';
import { ALL_COMMENTS_RIGHT } from './CommentList.tsx';
import { screenBox, toScreenPoint, toWorldPoint, type AnchorState, type Box, type Camera, type PinPlace, type Point } from './pins.ts';

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** A dragged area narrower or shorter than this is dropped. */
const AREA_MIN = 12;

export const COMMENT_TARGET = '#ae7303';





const BUBBLE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><path d='M 2 26 L 2 14 A 12 12 0 1 1 14 26 Z' fill='#000' stroke='#fff' stroke-width='2'/></svg>";
export const COMMENT_CURSOR = `url("data:image/svg+xml,${BUBBLE_SVG.replace(/[ '<>#]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}") 2 26, crosshair`;

/** The agent as comment UI shows it. */
export interface AgentBadge {
  available: boolean;
  name: string;
  /** false: an idle agent is not woken (Cursor); what is sent waits until the person next talks to it. */
  wakesIdle?: boolean;
}


/** Stops surface gestures from starting inside comment UI. */
const stop = (event: { stopPropagation(): void }): void => event.stopPropagation();

/** A short "5m ago" style time. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/* -------------------------------------------------------------------------- */
/* Capture                                                                     */
/* -------------------------------------------------------------------------- */

export interface CommentCaptureProps<A> {
  comments: CommentsController<A>;
  /** Comment mode applies here now (the editor's surface is showing). */
  enabled: boolean;
  /** Space is held: the surface underneath pans. */
  panning?: boolean;
  /** The surface's camera at this moment (read on release, so a live camera mid-glide is fine). */
  camera(): Camera;
  /** What lies under a world point. */
  anchorAt(world: Point): A;
  /** The anchor of a dragged area (world corners). */
  areaAnchor(a: Point, b: Point): A;
  /** The world box of an anchor: outlined under the pointer, so it shows what a click comments on. */
  highlight?(anchor: A): Box | null;
  /** What lies under the resting pointer (`null` once it leaves, drags or the camera moves). */
  onHover?(anchor: A | null): void;
  /** Changes when what lies under the pointer may have changed without it moving (e.g. an artboard finished loading). */
  revision?: unknown;
}

/** In comment mode: clicks place threads, drags draw areas. */
export function CommentCapture<A>({ comments, enabled, panning = false, camera, anchorAt, areaAnchor, highlight, onHover, revision }: CommentCaptureProps<A>): ReactNode {
  const on = comments.store((s) => s.on);
  const open = comments.store((s) => s.draft !== null || Boolean(s.active));
  const element = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const [area, setArea] = useState<Box | null>(null);
  // The box under the pointer, in this layer's pixels (one pick per frame).
  const [hover, setHover] = useState<Box | null>(null);
  const hoverFrame = useRef(0);
  /** Where the pointer rests (layer pixels), to pick again on `revision`. */
  const resting = useRef<Point | null>(null);
  const pickAgain = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelAnimationFrame(hoverFrame.current), []);
  const live = on && enabled;
  useEffect(() => {
    if (live) pickAgain.current?.();
  }, [revision]);
  // Escape during a drag drops the area (before the editor's own Escape).
  useEffect(() => {
    if (!area) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      press.current = null;
      setArea(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [area !== null]);
  // Leaving comment mode forgets the pointer.
  useEffect(() => {
    if (live) return;
    resting.current = null;
    setHover(null);
  }, [live]);
  if (!on || !enabled || !comments.canComment()) return null;

  const local = (event: { clientX: number; clientY: number }): Point => {
    const bounds = element.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const onDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || panning) return;
    event.stopPropagation();
    event.preventDefault();
    press.current = local(event);
    try {
      element.current!.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events carry no capturable pointer.
    }
  };
  const clearHover = (): void => {
    cancelAnimationFrame(hoverFrame.current);
    resting.current = null;
    setHover(null);
    onHover?.(null);
  };
  const trackHover = (point: Point): void => {
    resting.current = point;
    if (!highlight && !onHover) return;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      const cam = camera();
      const anchor = anchorAt(toWorldPoint(cam, point));
      onHover?.(anchor);
      if (!highlight) return;
      const box = highlight(anchor);
      const next = box ? { x: box.x * cam.zoom + cam.x, y: box.y * cam.zoom + cam.y, w: box.w * cam.zoom, h: box.h * cam.zoom } : null;
      setHover((last) => (last && next && last.x === next.x && last.y === next.y && last.w === next.w && last.h === next.h ? last : next));
    });
  };
  pickAgain.current = () => {
    if (resting.current && !press.current) trackHover(resting.current);
  };
  const cancelDrag = (): void => {
    press.current = null;
    setArea(null);
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = press.current;
    if (!start) {
      if (panning || event.buttons) clearHover();
      else trackHover(local(event));
      return;
    }
    // The button came up out of sight (another window took the release): the drag is over.
    if ((event.buttons & 1) === 0) {
      cancelDrag();
      return;
    }
    const point = local(event);
    // Hidden while pressed; what lies under the pointer stays as it was (the release picks it).
    if (hover) setHover(null);
    if (!area && Math.hypot(point.x - start.x, point.y - start.y) < DRAG_THRESHOLD) return;
    setArea({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), w: Math.abs(point.x - start.x), h: Math.abs(point.y - start.y) });
  };
  const onUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = press.current;
    press.current = null;
    if (!start) return;
    event.stopPropagation();
    const cam = camera();
    const point = local(event);
    const state = comments.store.getState();
    // Decided from the press and the release, not the drawn area: the last move may not have rendered yet.
    const w = Math.abs(point.x - start.x);
    const h = Math.abs(point.y - start.y);
    if (area || Math.hypot(w, h) >= DRAG_THRESHOLD) {
      setArea(null);
      // Too small to be an area: dropped.
      if (w < AREA_MIN || h < AREA_MIN) return;
      state.setDraft(areaAnchor(toWorldPoint(cam, start), toWorldPoint(cam, point)));
      return;
    }
    
    state.setDraft(anchorAt(toWorldPoint(cam, point)));
  };

  return (
    <div
      ref={element}
      data-comment-capture=""
      aria-label="Comment mode: click to comment, drag to comment on an area"
      className="absolute inset-0 z-[2]"
      style={{ cursor: panning ? 'grab' : COMMENT_CURSOR }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={cancelDrag}
      onPointerLeave={clearHover}
      // The camera moves under a still pointer: the next move picks again.
      onWheel={clearHover}
      onDoubleClick={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      {hover && !area && !open && !panning ? (
        <div data-comment-hover="" className="pointer-events-none absolute rounded" style={{ left: hover.x, top: hover.y, width: hover.w, height: hover.h, border: `1.5px solid ${COMMENT_TARGET}` }} />
      ) : null}
      {area && press.current ? <AreaOutline area={area} start={press.current} /> : null}
    </div>
  );
}


function AreaOutline({ area, start }: { area: Box; start: Point }): ReactNode {
  return (
    <>
      <div data-comment-area="" className="pointer-events-none absolute" style={{ left: area.x, top: area.y, width: area.w, height: area.h, border: `1px dashed ${COMMENT_TARGET}` }} />
      <div className="pointer-events-none absolute rounded-full" style={{ left: start.x - 5, top: start.y - 5, width: 10, height: 10, background: COMMENT_TARGET }} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Placing pins and cards                                                      */
/* -------------------------------------------------------------------------- */


const PIN = 36;
const PIN_GAP = 4;
const EDGE = 8;
/** A thread's card and the composer: 330px wide, 6px from the pin. */
const CARD_WIDTH = 330;
const CARD_GAP = 6;
/** The least room a card keeps beside its pin, however near the edge the pin is. */
const CARD_MIN_ROOM = 48;

type Size = { width: number; height: number };

/** Where a pin goes for a point (surface px): below it, or above it when the room is there. */
export interface PinBox {
  left: number;
  top: number;
  /** Above the point. */
  flip: boolean;
}


export function pinBox(point: Point, viewport: Size): PinBox {
  const below = viewport.height - (point.y + PIN_GAP);
  const above = point.y - PIN_GAP;
  const flip = below < 320 && above > below && (above >= 240 || (below < 240 && above >= 48));
  const left = Math.min(Math.max(point.x, 0), Math.max(0, viewport.width - (PIN + EDGE)));
  return { left, top: flip ? point.y - (PIN + PIN_GAP) : point.y + PIN_GAP, flip };
}

const cardCap = (height: number): number => Math.max(320, Math.round(height * 0.6));

/** How tall the card beside `pin` may be: the cap, or the room on the pin's side, whichever is less. */
function cardMaxHeight(pin: PinBox, viewport: Size): number {
  const top = EDGE;
  const bottom = viewport.height - EDGE;
  const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
  const room = pin.flip
    ? clamp(pin.top + PIN + 2, Math.min(bottom, top + CARD_MIN_ROOM), bottom) - top
    : bottom - clamp(pin.top - 2, top, Math.max(top, bottom - CARD_MIN_ROOM));
  return Math.min(cardCap(viewport.height), Math.max(0, room));
}

export interface CommentPopoverProps {
  /** Beside this pin… */
  pin?: PinBox;
  /** …or with its top-left corner here (a page that marks its threads itself). */
  corner?: Point;
  /** The surface it is kept inside (px, from the layer's top-left corner). */
  viewport: Size;
  /** Its width (px; default 330). */
  width?: number;
  onEscape(): void;
  /** A function gets the height the card may take, and the popover keeps to it. */
  children: ReactNode | ((maxHeight: number) => ReactNode);
}


export function CommentPopover({ pin, corner, viewport, width: wanted = CARD_WIDTH, onEscape, children }: CommentPopoverProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(0, Math.min(wanted, viewport.width - 2 * EDGE));
  let left: number;
  let top: number;
  let maxHeight: number | undefined;
  if (corner || !pin) {
    const at = corner ?? { x: EDGE, y: EDGE };
    left = Math.max(EDGE, Math.min(at.x, viewport.width - EDGE - width));
    top = Math.max(EDGE, Math.min(at.y, viewport.height - EDGE - height));
    if (typeof children === 'function') maxHeight = Math.min(cardCap(viewport.height), Math.max(CARD_MIN_ROOM, viewport.height - EDGE - Math.max(EDGE, at.y)));
  } else {
    left = pin.left + PIN + CARD_GAP;
    if (left + width > viewport.width - EDGE) {
      const before = pin.left - CARD_GAP - width;
      left = before >= EDGE ? before : Math.max(EDGE, viewport.width - EDGE - width);
    }
    top = pin.flip ? pin.top + PIN + 2 - height : pin.top - 2;
    top = Math.max(EDGE, Math.min(top, viewport.height - EDGE - height));
    if (typeof children === 'function') maxHeight = cardMaxHeight(pin, viewport);
  }
  // Unmeasured, it is see-through rather than hidden: a hidden textarea can't take focus.
  const style: CSSProperties & { '--comment-card-room'?: string } = {
    position: 'absolute',
    left,
    top,
    width,
    pointerEvents: 'auto',
    ...(maxHeight === undefined ? {} : { maxHeight, '--comment-card-room': `${maxHeight}px`, display: 'flex', flexDirection: 'column' }),
    ...(height ? {} : { opacity: 0, pointerEvents: 'none' }),
  };
  return (
    <div
      ref={ref}
      style={style}
      data-comment-card=""
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onEscape();
      }}
    >
      {typeof children === 'function' ? children(maxHeight!) : children}
    </div>
  );
}

const PIN_CLASS =
  'cds-reset absolute flex items-center justify-center rounded-full rounded-tl-none border-0 p-0 cursor-[var(--cds-cursor-interactive)] outline-none focus-visible:outline-hidden focus-visible:shadow-focus';


function PinButton({
  pin,
  avatar,
  draft = false,
  label,
  title,
  expanded,
  faded = false,
  ...handlers
}: {
  pin: PinBox;
  avatar: ReactNode;
  draft?: boolean;
  label: string;
  title?: string;
  expanded?: boolean;
  faded?: boolean;
  onClick?(): void;
  onPointerDown?(event: ReactPointerEvent<HTMLButtonElement>): void;
  onPointerMove?(event: ReactPointerEvent<HTMLButtonElement>): void;
  onPointerUp?(event: ReactPointerEvent<HTMLButtonElement>): void;
  pinId?: string;
}): ReactNode {
  const { pinId, ...events } = handlers;
  const style: CSSProperties = {
    left: pin.left,
    top: pin.top,
    width: PIN,
    height: PIN,
    pointerEvents: draft ? 'none' : 'auto',
    touchAction: 'none',
    ...(pin.flip ? { borderRadius: '9999px 9999px 9999px 0' } : {}),
    ...(faded ? { opacity: 0.7 } : {}),
  };
  return (
    <button
      type="button"
      data-comment-pin={pinId}
      aria-label={label}
      title={title}
      aria-expanded={expanded}
      tabIndex={draft ? -1 : undefined}
      className={cn(PIN_CLASS, draft ? 'bg-fill-accent' : 'bg-surface-2 shadow-panel-sm')}
      style={style}
      {...events}
    >
      {/* A surface-colored backing makes the translucent avatar opaque, so it reads the same on the accent (draft) pin as on a plain one. */}
      <span className="flex rounded-full bg-surface-1">{avatar}</span>
    </button>
  );
}

/** A message's author as the cards name them. */
function authorName(message: CommentMessage, agent: AgentBadge): string {
  if (message.author.kind === 'agent') return message.author.name || agent.name;
  return message.author.name || 'Someone';
}

function threadAvatar(thread: CommentThread, agent: AgentBadge): ReactNode {
  const first = thread.messages[0];
  if (!first) return <Avatar name="?" size="sm" />;
  return <Avatar name={authorName(first, agent)} variant={first.author.kind === 'agent' ? 'agent' : 'default'} size="sm" />;
}

/* -------------------------------------------------------------------------- */
/* Pins                                                                        */
/* -------------------------------------------------------------------------- */

export interface CommentPinsProps<A> {
  comments: CommentsController<A>;
  /** The surface's camera (pins re-place when it changes). */
  camera: Camera;
  /** The surface's size: pins and cards are kept inside it; pins past its edges become "More comments" tabs. */
  viewport: Size;
  /** Where an anchor's pin sits on the surface shown now; `null`: not here (another page, no pin, orphaned). */
  place(anchor: A): PinPlace | null;
  /** The world box an open thread highlights. */
  highlight?(anchor: A): Box | null;
  /** What lies under a world point (where a dragged pin lands); without it (and {@link onMove}) pins are not dragged. */
  anchorAt?(world: Point): A;
  /** Pins can be dragged to move their thread (default: when {@link anchorAt} or {@link onMove} is given). */
  movable?: boolean;
  /** A pin dropped at a screen point: the host moves the thread itself (instead of `comments.move(anchorAt(…))`). */
  onMove?(id: string, screen: Point): void;
  agent: AgentBadge;
  /** Changes whenever pins may have moved without threads or camera changing (document edits, layout). */
  revision?: unknown;
  /** Pins past the surface's edges become "More comments" tabs at that edge (default: on). */
  piles?: boolean;
  /** Bars over the surface's edges (px): a toolbar at its top or its bottom, which the tabs keep clear of. */
  insets?: { top?: number; bottom?: number };
}

interface Placed<A> {
  key: string;
  thread: CommentThread | null;
  anchor: A;
  state: AnchorState;
  screen: Point;
}






export function CommentPins<A>({ comments, camera, viewport, place, highlight, anchorAt, movable, onMove, agent, revision, piles = true, insets }: CommentPinsProps<A>): ReactNode {
  const canMove = (movable ?? true) && Boolean(anchorAt || onMove);
  const available = comments.store((s) => s.available);
  const threads = comments.store((s) => s.threads);
  const active = comments.store((s) => s.active);
  const draft = comments.store((s) => s.draft);
  const on = comments.store((s) => s.on);
  const showResolved = comments.store((s) => s.showResolved);
  const listOpen = comments.store((s) => s.listOpen);
  // A dragged pin's offset from its place.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const placed = useMemo((): Placed<A>[] => {
    if (!available) return [];
    const out: Placed<A>[] = [];
    for (const thread of threads) {
      if (thread.messages.length === 0) continue;
      if (thread.status !== 'open' && !showResolved && thread.id !== active) continue;
      const anchor = comments.anchorOf(thread);
      const at = place(anchor);
      if (at) out.push({ key: thread.id, thread, anchor, state: at.state, screen: toScreenPoint(camera, at.world) });
    }
    if (draft !== null) {
      const at = place(draft);
      if (at) out.push({ key: 'draft', thread: null, anchor: draft, state: at.state, screen: toScreenPoint(camera, at.world) });
    }
    return out;
  }, [available, threads, active, draft, showResolved, camera, place, revision, comments]);

  if (!available) return null;
  if (!on && !active && draft === null && placed.length === 0) return null;

  const focusKey = draft !== null ? 'draft' : active;
  const focus = placed.find((p) => p.key === focusKey);
  const lit = focus && highlight ? highlight(focus.anchor) : null;
  const pinned = placed.filter((p) => p.thread);

  const pileSet = piles
    ? edgePiles({
        points: pinned.map((p) => ({ id: p.key, x: p.screen.x, y: p.screen.y })),
        openId: active,
        box: { left: 0, top: 0, width: viewport.width, height: viewport.height },
        top: 0,
        floor: insets?.top ?? 0,
        foot: insets?.bottom ? insets.bottom + 8 : 0,
        reserveRight: listOpen ? ALL_COMMENTS_RIGHT : 0,
      })
    : null;
  const shown = pinned.filter((p) => !pileSet?.piled.has(p.key)).map((p) => ({ ...p, box: pinBox(p.screen, viewport) }));
  const stacked = stackPins(
    shown.map((p) => ({ id: p.key, x: p.box.left, y: p.box.top, w: PIN })),
    viewport.width,
    PIN,
  );
  const select = (id: string | null): void => comments.store.getState().setActive(id);
  const open = focus?.thread ? focus : undefined;

  return (
    <>
      {lit ? (
        // An area is drawn as it was dragged (dashed); an element, a board or a note gets the hover ring.
        <div
          data-comment-target=""
          className={cn('pointer-events-none absolute', !lit.area && 'rounded')}
          style={{ ...screenBox(camera, lit), border: lit.area ? `1px dashed ${COMMENT_TARGET}` : `1.5px solid ${COMMENT_TARGET}` }}
        />
      ) : null}
      <CommentsLayer
        className="pointer-events-none absolute inset-0 z-[3]"
        mark="data-comment-layer"
        onEscape={() => {
          const state = comments.store.getState();
          if (state.draft !== null || state.active) {
            state.setDraft(null);
            state.setActive(null);
            return true;
          }
          return false;
        }}
      >
        {shown.map((p) => {
          const thread = p.thread!;
          const dragging = drag?.id === thread.id ? drag : null;
          const box = { ...p.box, left: p.box.left + (stacked.get(p.key) ?? 0) + (dragging?.x ?? 0), top: p.box.top + (dragging?.y ?? 0) };
          return (
            <ThreadPin
              key={p.key}
              comments={comments}
              thread={thread}
              box={box}
              avatar={threadAvatar(thread, agent)}
              expanded={active === thread.id}
              detached={p.state === 'detached'}
              onDrag={(delta) => setDrag(delta ? { id: thread.id, ...delta } : null)}
              movable={canMove}
              onDrop={(delta) => {
                const screen = { x: p.screen.x + delta.x, y: p.screen.y + delta.y };
                if (onMove) onMove(thread.id, screen);
                else if (anchorAt) void comments.move(thread.id, anchorAt(toWorldPoint(camera, screen)));
              }}
            />
          );
        })}
        {pileSet ? (
          <div style={{ display: 'contents', pointerEvents: 'auto' }}>
            <EdgePiles
              piles={pileSet}
              onOpen={(id) => {
                const thread = threads.find((t) => t.id === id);
                if (thread) comments.show(thread);
              }}
            />
          </div>
        ) : null}
        {open ? (
          <CommentPopover key={open.key} pin={pinBox(open.screen, viewport)} viewport={viewport} onEscape={() => select(null)}>
            {(maxHeight) => <ThreadCard comments={comments} agent={agent} thread={open.thread!} state={open.state} maxHeight={maxHeight} />}
          </CommentPopover>
        ) : null}
        {focus && !focus.thread && draft !== null ? (
          <>
            <PinButton pin={pinBox(focus.screen, viewport)} draft label="New comment" avatar={<Avatar name={comments.viewerName()} size="sm" />} />
            <CommentPopover pin={pinBox(focus.screen, viewport)} viewport={viewport} onEscape={() => comments.store.getState().setDraft(null)}>
              {() => <CommentComposer comments={comments} agent={agent} anchor={draft} />}
            </CommentPopover>
          </>
        ) : null}
      </CommentsLayer>
    </>
  );
}

/** One thread's pin: a click opens its card, a drag moves the thread. */
function ThreadPin<A>({
  comments,
  thread,
  box,
  avatar,
  expanded,
  detached,
  movable,
  onDrag,
  onDrop,
}: {
  comments: CommentsController<A>;
  thread: CommentThread;
  box: PinBox;
  avatar: ReactNode;
  expanded: boolean;
  detached: boolean;
  movable: boolean;
  onDrag(delta: Point | null): void;
  onDrop(delta: Point): void;
}): ReactNode {
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** The last press was a drag: the click that follows it does nothing. */
  const dragged = useRef(false);
  const resolved = thread.status === 'resolved';
  return (
    <PinButton
      pinId={thread.id}
      pin={box}
      avatar={avatar}
      expanded={expanded}
      faded={detached}
      label={`Comment: ${thread.label}${resolved ? ' (resolved)' : ''}`}
      title={detached ? 'What this comment was on is gone' : thread.label}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        press.current = { x: event.clientX, y: event.clientY, moved: false };
        dragged.current = false;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // no capturable pointer
        }
      }}
      onPointerMove={(event) => {
        const p = press.current;
        if (!p || !movable || !comments.canComment()) return;
        const dx = event.clientX - p.x;
        const dy = event.clientY - p.y;
        if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        p.moved = true;
        onDrag({ x: dx, y: dy });
      }}
      onPointerUp={(event) => {
        const p = press.current;
        press.current = null;
        if (!p?.moved) return;
        dragged.current = true;
        onDrag(null);
        onDrop({ x: event.clientX - p.x, y: event.clientY - p.y });
      }}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        const state = comments.store.getState();
        state.setActive(state.active === thread.id ? null : thread.id);
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* A thread's card                                                             */
/* -------------------------------------------------------------------------- */


function useFollowReplies(region: RefObject<HTMLDivElement | null>, thread: CommentThread) {
  const follow = useRef<{ after: string | undefined; at: number } | null>(null);
  useLayoutEffect(() => {
    const f = follow.current;
    const el = region.current;
    if (!f || !el) return;
    el.scrollTop = el.scrollHeight;
    const newest = thread.messages.at(-1);
    if (newest && newest.id !== f.after && newest.author.kind === 'agent') {
      const item = [...el.querySelectorAll('[data-cds-part="comment"]')].at(-1);
      const over = item ? el.getBoundingClientRect().top - item.getBoundingClientRect().top : 0;
      if (over > 0) {
        el.scrollTop -= over;
        follow.current = null;
        return;
      }
    }
    f.at = el.scrollTop;
  });
  const stop = (): void => {
    follow.current = null;
  };
  return {
    start: () => {
      follow.current = { after: thread.messages.at(-1)?.id, at: 0 };
    },
    regionProps: {
      onPointerDownCapture: stop,
      onWheelCapture: (event: WheelEvent<HTMLElement>) => {
        if (event.deltaY < 0) stop();
      },
      onScroll: (event: UIEvent<HTMLElement>) => {
        const el = event.currentTarget;
        const f = follow.current;
        if (f && Math.abs(el.scrollTop - f.at) > 2 && el.scrollHeight - el.scrollTop - el.clientHeight > 2) stop();
      },
    },
  };
}

export interface ThreadCardProps<A> {
  comments: CommentsController<A>;
  agent: AgentBadge;
  thread: CommentThread;
  /** How its anchor resolves (default: asked of the controller); a note under the first comment says what changed. */
  state?: AnchorState;
  /** The comments scroll past this height; the reply box stays under them. */
  maxHeight?: number;
  /** The close button (default: closes the card). */
  onClose?(): void;
}

export function ThreadCard<A>(props: ThreadCardProps<A>): ReactNode {
  return (
    <InLayer>
      <ThreadCardBody {...props} />
    </InLayer>
  );
}

function ThreadCardBody<A>({ comments, agent, thread, state, maxHeight, onClose }: ThreadCardProps<A>): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replying, setReplying] = useState(false);
  const change = comments.store((s) => s.statusChange);
  const nameId = useId();
  const region = useRef<HTMLDivElement>(null);
  const follow = useFollowReplies(region, thread);
  const draft = comments.store((s) => s.replies[thread.id]) ?? { text: '', send: false };
  const sendable = comments.canSendToAgent() && agent.available;
  const commenting = comments.canComment();
  const [top, ...replies] = thread.messages;
  if (!top) return null;
  const close = onClose ?? (() => comments.store.getState().setActive(null));
  const note = comments.stateNote(state ?? comments.stateOf(comments.anchorOf(thread)));
  const sendLabel = `Send to ${agent.name}`;
  const topItems: MenuItemSpec[] = comments.canRemove()
    ? [{ label: 'Delete thread', icon: 'Trash', variant: 'danger', onSelect: () => setConfirming(true) }]
    : [];
  const status = thread.status === 'open' ? thread.agent?.status : undefined;
  const working: WorkingState | undefined = status === 'pending' ? 'queued' : status === 'delivered' ? 'working' : undefined;
  const setDraft = (next: { text: string; send: boolean }): void => comments.store.getState().setReply(thread.id, next);

  return (
    <CommentCard
      expanded
      active
      onClose={close}
      labelledBy={nameId}
      maxHeight={maxHeight}
      scrollRef={region}
      scrollProps={follow.regionProps}
      className="min-h-0 flex-1"
      reply={
        commenting && (
          <ReplyField>
            <CdsComposer
              label="Reply"
              placeholder={thread.status === 'resolved' ? 'Reply to reopen…' : sendable && draft.send ? 'What do you want to edit?' : undefined}
              value={draft.text}
              onChange={(text) => setDraft({ ...draft, text })}
              sendBox={sendable ? { label: sendLabel, checked: draft.send, onCheckedChange: (send) => setDraft({ ...draft, send }) } : undefined}
              busy={replying}
              onSubmit={(text, { send }) => {
                follow.start();
                setReplying(true);
                void comments.reply(thread.id, text, { send: sendable && send }).finally(() => setReplying(false));
              }}
              onCancel={close}
            />
          </ReplyField>
        )
      }
    >
      <Comment
        nameId={nameId}
        authorName={authorName(top, agent)}
        agent={top.author.kind === 'agent'}
        timestamp={commentTime(top.at)}
        footnote={note ?? undefined}
        confirm={
          confirming ? (
            <DeleteConfirm
              busy={deleting}
              onCancel={() => setConfirming(false)}
              onDelete={() => {
                setDeleting(true);
                void comments.remove(thread.id).finally(() => setDeleting(false));
              }}
            />
          ) : undefined
        }
        actions={
          commenting || topItems.length > 0 ? (
            <Actions>
              {commenting ? (
                <ResolveAction
                  resolved={thread.status === 'resolved'}
                  disabled={change !== null}
                  onResolve={() => void comments.resolve(thread.id, true)}
                />
              ) : null}
              <MoreMenu
                items={topItems}
                disabled={change !== null && change.id !== thread.id}
                waitReason={change?.id === thread.id ? WAIT_FOR_STATUS_CHANGE : undefined}
              />
            </Actions>
          ) : undefined
        }
      >
        {commentMarkdown(top.text)}
      </Comment>
      {replies.length > 0 || working ? (
        <Replies>
          {replies.map((message) => (
            <Comment key={message.id} authorName={authorName(message, agent)} agent={message.author.kind === 'agent'} timestamp={commentTime(message.at)}>
              {commentMarkdown(message.text)}
            </Comment>
          ))}
          {working ? <Comment authorName={agent.name} agent working={working} footnote={working === 'queued' ? queuedNote(agent) : 'Working…'} /> : null}
        </Replies>
      ) : null}
    </CommentCard>
  );
}

/* -------------------------------------------------------------------------- */
/* The new comment's composer                                                  */
/* -------------------------------------------------------------------------- */

export interface CommentComposerProps<A> {
  comments: CommentsController<A>;
  agent: AgentBadge;
  /** What the new thread is on. */
  anchor: A;
  /** Escape and Cancel (default: drops the draft). */
  onCancel?(): void;
}


export function CommentComposer<A>(props: CommentComposerProps<A>): ReactNode {
  return (
    <InLayer>
      <ComposerBody {...props} />
    </InLayer>
  );
}

function ComposerBody<A>({ comments, agent, anchor, onCancel }: CommentComposerProps<A>): ReactNode {
  const text = comments.store((s) => s.draftText);
  const send = comments.store((s) => s.sendNew);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const sendable = comments.canSendToAgent() && agent.available;
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, [anchor]);
  const cancel = (): void => (onCancel ? onCancel() : comments.store.getState().setDraft(null));
  return (
    <CdsComposer
      textareaRef={field}
      context={comments.labelOf(anchor)}
      value={text}
      onChange={(next) => comments.store.getState().setDraftText(next)}
      sendBox={sendable ? { label: `Send to ${agent.name}`, checked: send, onCheckedChange: (on) => comments.store.getState().setSendNew(on) } : undefined}
      busy={busy}
      onSubmit={(body, how) => {
        if (busy) return;
        setBusy(true);
        void comments.create(anchor, body, { send: sendable && how.send }).finally(() => setBusy(false));
      }}
      onCancel={cancel}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* The comments button                                                         */
/* -------------------------------------------------------------------------- */

export interface CommentsButtonProps<A> {
  comments: CommentsController<A>;
  /** The comment-mode key its tooltip names (default C). */
  shortcut?: string;
  /** The tooltips' side (default: below, for a bar at the top). */
  side?: 'top' | 'bottom';
}

export function CommentsButton<A>({ comments, shortcut = 'C', side = 'bottom' }: CommentsButtonProps<A>): ReactNode {
  const available = comments.store((s) => s.available);
  if (!available) return null;
  return (
    <CommentsLayer inline mark="data-comments-button">
      <ButtonBody comments={comments} shortcut={shortcut} side={side} />
    </CommentsLayer>
  );
}

function ButtonBody<A>({ comments, shortcut, side }: Required<CommentsButtonProps<A>>): ReactNode {
  const [menuOpen, setMenuOpen] = useLayerMenu();
  const count = comments.store((s) => openMessageCount(s.threads));
  const on = comments.store((s) => s.on);
  const panelOpen = comments.store((s) => s.listOpen);
  const waiting = !on && count > 0;
  const tip = on ? 'Done commenting' : count > 0 ? `${count} open ${count === 1 ? 'comment' : 'comments'}` : 'Comments';
  const setPanel = (open: boolean): void => {
    setMenuOpen(false);
    comments.store.getState().setListOpen(open);
  };
  const item: MenuItemSpec = panelOpen ? { label: 'Hide comments', onSelect: () => setPanel(false) } : { label: 'Show all comments', trailing: count, onSelect: () => setPanel(true) };
  return (
    <span className="flex shrink-0 items-center">
      {comments.canComment() ? (
        <Tooltip content={tip} shortcut={shortcut} side={side}>
          <Button
            variant="ghost"
            iconOnly
            tooltip={false}
            aria-label="Comments"
            aria-pressed={on}
            icon={
              <span className="relative inline-flex">
                <Icon name={on ? 'CommentFilled' : 'Comment'} size="sm" />
                {waiting ? (
                  <span aria-hidden className="absolute rounded-full bg-fill-accent" style={{ top: -1, right: -2, width: 6, height: 6, boxShadow: '0 0 0 1.5px var(--cds-page-bg)' }} />
                ) : null}
              </span>
            }
            onClick={() => comments.store.getState().setOn(!on)}
          />
        </Tooltip>
      ) : null}
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <Tooltip content="Comment options" disabled={menuOpen} side={side}>
          <Menu.Trigger
            render={
              <Button variant="ghost" aria-label="Comment options" style={{ paddingInline: 2 }}>
                <Icon name="CaretDown" size="xs" />
              </Button>
            }
          />
        </Tooltip>
        <MenuPopup align="end">
          <MenuItems items={[item]} />
        </MenuPopup>
      </Menu.Root>
    </span>
  );
}
