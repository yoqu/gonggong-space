/**
 * Renders one slide model to DOM at canvas size (1920×1080).
 *
 * Layering follows the format: pinned children of the section are placed
 * against the section; all flow children paint as ONE layer (the flow root,
 * which carries the section's layout declarations) at the source position of
 * the first flow child. Every element carries `data-open-artifact-path` (its path key),
 * which is how the editor hit-tests and measures what it draws.
 *
 * The same component draws the editing stage, rail thumbnails, the presenter
 * and export captures; `RenderOptions` says which.
 */

import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  isPinned,
  pathKey,
  videoEmbedUrl,
  videoThumbnailUrl,
  type BuildSpec,
  type ConnectorNode,
  type IconNode,
  type ImageNode,
  type ListNode,
  type NodePath,
  type Run,
  type ShapeNode,
  type Slide,
  type SlideNode,
  type StyleMap,
  type SvgNode,
  type TableNode,
  type TextBoxNode,
  type TextNode,
  type EmbedNode,
} from '@open-artifact/slides-core';
import { ImageIcon, Play, Video } from 'lucide-react';
import { SECTION_LAYOUT, SLIDE_CLASS, toReactStyle, installSlideStyles, withItemMargin } from './css.ts';
import { embedDocument, mountEmbedStill } from './embed-still.ts';
import { useTextFit } from './fit.ts';
import { guardSmil } from '../services/motion.ts';
import { ICON_GLYPHS } from './icons.tsx';
import {
  connectorGeometry,
  connectorStroke,
  dashArray,
  headWings,
  parseStroke,
  polylineData,
  shaftPoints,
  SHAPE_POLYGONS,
} from './geometry.ts';

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

/** Where a slide is being drawn. */
export type RenderMode = 'edit' | 'thumb' | 'present' | 'export';

/** Where a build-animated element is in its life while presenting. */
export type BuildPhase = 'before' | 'entering' | 'shown' | 'exiting' | 'gone';

/** Build state of a slide's pinned children, keyed by child index. */
export type BuildPhases = ReadonlyMap<number, BuildPhase>;

/** How a slide is drawn. */
export interface RenderOptions {
  mode: RenderMode;
  /** Capture embeds when an export needs a static picture. */
  captureEmbeds?: boolean;
  /** Turns an asset reference (`/_blob/…`, `project/ds/…`) into a URL. */
  resolveSrc: (src: string) => string;
  /**
   * Replaces the rendering of one node (in-place text editing). Return
   * undefined to draw the node normally.
   */
  override?: (node: SlideNode, path: NodePath) => ReactNode | undefined;
  /** Present mode: the phase of each build-animated pinned child. */
  builds?: BuildPhases;
  /** Present mode: clips started by a click (keys are path keys). */
  startedClips?: ReadonlySet<string>;
  /** Present mode: called when a click-to-start clip is clicked. */
  onStartClip?: (key: string) => void;
}

const identity = (src: string): string => src;
const DEFAULT_OPTIONS: RenderOptions = { mode: 'edit', resolveSrc: identity };
const OptionsContext = createContext<RenderOptions>(DEFAULT_OPTIONS);

/** Clips that may play at once on one slide (uploaded and hosted alike). */
export const LIVE_CLIP_CAPACITY = 4;

/**
 * Hands out playback slots on one slide. A clip takes a slot before it
 * mounts its player and gives it back when it unmounts; a clip that found no
 * free slot shows its poster and tries again whenever one is given back.
 */
export interface ClipCapacity {
  take(): boolean;
  give(): void;
  onFree(listener: () => void): () => void;
}

/** A fresh capacity of `limit` slots. */
export function createClipCapacity(limit = LIVE_CLIP_CAPACITY): ClipCapacity {
  let used = 0;
  const listeners = new Set<() => void>();
  return {
    take() {
      if (used >= limit) return false;
      used++;
      return true;
    },
    give() {
      used = Math.max(0, used - 1);
      for (const listener of [...listeners]) listener();
    },
    onFree(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const ClipCapacityContext = createContext<ClipCapacity | null>(null);

/** True while this clip holds a playback slot (always true outside a capacity). */
function useClipSlot(active: boolean): boolean {
  const capacity = useContext(ClipCapacityContext);
  const [held, setHeld] = useState(false);
  useLayoutEffect(() => {
    if (!active || !capacity) return;
    let mine = false;
    const attempt = (): void => {
      if (mine || !capacity.take()) return;
      mine = true;
      setHeld(true);
    };
    attempt();
    const unsubscribe = capacity.onFree(attempt);
    return () => {
      unsubscribe();
      setHeld(false);
      if (mine) capacity.give();
    };
  }, [active, capacity]);
  return !capacity || held;
}

/** Options of the slide being drawn. */
export function useRenderOptions(): RenderOptions {
  return useContext(OptionsContext);
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Size of an element's content box, kept current. The ref is re-read after
 * every render, so an element mounted later (after a placeholder) or swapped
 * for another is still observed.
 */
export function useElementSize(ref: RefObject<Element | null>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [el, setEl] = useState<Element | null>(null);
  // Runs after every render: picks up the element once it exists.
  useLayoutEffect(() => {
    if (ref.current !== el) setEl(ref.current);
  });
  useLayoutEffect(() => {
    if (!el) return;
    const read = (): void => {
      const rect = el.getBoundingClientRect();
      const box = el as HTMLElement;
      // offsetWidth is unscaled (the stage is CSS-scaled); SVG has none, fall back to the client box.
      const w = box.offsetWidth ?? (el as SVGGraphicsElement).clientWidth ?? rect.width;
      const h = box.offsetHeight ?? (el as SVGGraphicsElement).clientHeight ?? rect.height;
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return size;
}

/** The inline style of an `svg` element's markup: `prop:value;…`. */
function cssText(style: StyleMap): string {
  return Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

/** `box-shadow` layers as `drop-shadow()` filters (outer shadows only; spread is dropped). */
function dropShadows(boxShadow: string | undefined): string {
  if (!boxShadow) return '';
  const layers: string[] = [];
  for (const layer of boxShadow.split(/,(?![^(]*\))/)) {
    const text = layer.trim();
    if (!text || text.startsWith('inset')) continue;
    const lengths = text.match(/-?[\d.]+px/g) ?? [];
    const color = text.replace(/-?[\d.]+px/g, '').trim() || 'rgba(0,0,0,0.3)';
    const [x = '0px', y = '0px', blur = '0px'] = lengths;
    layers.push(`drop-shadow(${x} ${y} ${blur} ${color})`);
  }
  return layers.join(' ');
}

/** Class name of a pinned child's build state. */
function buildClass(phase: BuildPhase | undefined, buildIn?: BuildSpec, buildOut?: BuildSpec): string | undefined {
  switch (phase) {
    case 'before':
    case 'gone':
      return 'open-artifact-build-hidden';
    case 'entering':
      return `open-artifact-build-in open-artifact-fx-${buildIn?.effect ?? 'fade'}`;
    case 'exiting':
      return `open-artifact-build-out open-artifact-fx-${buildOut?.effect ?? 'fade'}`;
    default:
      return undefined;
  }
}

/** Common attributes of a rendered element. */
interface NodeFrame {
  className?: string;
  'data-open-artifact-path': string;
  'data-open-artifact-kind': SlideNode['kind'];
}

function frameOf(node: SlideNode, path: NodePath, className: string | undefined, phase?: BuildPhase): NodeFrame {
  const build = path.length === 1 ? buildClass(phase, node.buildIn, node.buildOut) : undefined;
  const classes = [className, build].filter(Boolean).join(' ');
  return { className: classes || undefined, 'data-open-artifact-path': pathKey(path), 'data-open-artifact-kind': node.kind };
}

/* -------------------------------------------------------------------------- */
/* Rich text                                                                   */
/* -------------------------------------------------------------------------- */

/** Draws runs: marks as inline elements, `\n` as line breaks. */
export function RunsView({ runs, linkable }: { runs: readonly Run[]; linkable: boolean }): ReactNode {
  const out: ReactNode[] = [];
  runs.forEach((run, i) => {
    const lines = run.text.split('\n');
    let content: ReactNode = lines.flatMap((line, j) => (j === 0 ? [line] : [<br key={`br${j}`} />, line]));
    const marks = run.marks;
    if (marks?.color || marks?.regular) content = <span style={{ color: marks.color, fontWeight: marks.regular && !marks.b ? 400 : undefined }}>{content}</span>;
    if (marks?.u) content = <u>{content}</u>;
    if (marks?.i) content = <i>{content}</i>;
    if (marks?.b) content = <b>{content}</b>;
    if (marks?.href) {
      content = linkable ? (
        <a href={marks.href} target="_blank" rel="noopener noreferrer">
          {content}
        </a>
      ) : (
        <a href={marks.href} onClick={(e) => e.preventDefault()} tabIndex={-1}>
          {content}
        </a>
      );
    }
    out.push(<RunFragment key={i}>{content}</RunFragment>);
  });
  // A trailing line break needs something after it to show the empty line.
  const last = runs[runs.length - 1];
  if (last && last.text.endsWith('\n')) out.push(<br key="tail" />);
  if (runs.length === 0 || (runs.length === 1 && runs[0]!.text === '')) out.push(<br key="empty" />);
  return out;
}

function RunFragment({ children }: { children: ReactNode }): ReactNode {
  return children;
}

/* -------------------------------------------------------------------------- */
/* Node renderers                                                              */
/* -------------------------------------------------------------------------- */

interface NodeProps<N extends SlideNode = SlideNode> {
  node: N;
  path: NodePath;
}

function TextView({ node, path }: NodeProps<TextNode>): ReactNode {
  const ref = useRef<HTMLElement>(null);
  const options = useRenderOptions();
  useTextFit(ref, node.fit, [node]);
  const Tag = node.tag;
  const style = toReactStyle(node.style, { resolveUrl: options.resolveSrc });
  if (node.fit === 'grow') style.flexShrink = 0;
  return (
    <Tag ref={ref as RefObject<HTMLHeadingElement>} {...frameOf(node, path, 'open-artifact-text', options.builds?.get(path[0]!))} style={style}>
      <RunsView runs={node.runs} linkable={options.mode === 'present'} />
    </Tag>
  );
}

function ListView({ node, path, inBox }: NodeProps<ListNode> & { inBox?: boolean }): ReactNode {
  const ref = useRef<HTMLElement>(null);
  const options = useRenderOptions();
  useTextFit(ref, inBox ? 'none' : node.fit, [node]);
  const Tag = node.tag;
  const style = withItemMargin(toReactStyle(node.style, { resolveUrl: options.resolveSrc }), node.itemMargin);
  if (node.fit === 'grow') style.flexShrink = 0;
  return (
    <Tag ref={ref as RefObject<never>} {...frameOf(node, path, 'open-artifact-list', options.builds?.get(path[0]!))} style={style} start={node.start} reversed={node.reversed}>
      {listLevel(node.items, 0, 0, Tag, options.mode === 'present', node.levels).nodes}
    </Tag>
  );
}

/**
 * Items from `start` on that sit at `level` or deeper, as `<li>`s with their
 * deeper items nested in a list of the same tag. A skipped level is a
 * markerless item holding the deeper list.
 */
function listLevel(items: ListNode['items'], start: number, level: number, Tag: 'ul' | 'ol', linkable: boolean, levels?: ListNode['levels']): { nodes: ReactNode[]; next: number } {
  const look = levels?.[level + 1] ? toReactStyle(levels[level + 1]!) : undefined;
  const nodes: ReactNode[] = [];
  let i = start;
  while (i < items.length) {
    const at = items[i]!.level ?? 0;
    if (at < level) break;
    if (at > level) {
      const inner = listLevel(items, i, level + 1, Tag, linkable, levels);
      nodes.push(
        <li key={`skip-${i}`} style={{ listStyleType: 'none', marginTop: 0, marginBottom: 0 }}>
          <Tag style={look}>{inner.nodes}</Tag>
        </li>,
      );
      i = inner.next;
      continue;
    }
    const key = i;
    const runs = items[i]!.runs;
    i++;
    let nested: ReactNode = null;
    if (i < items.length && (items[i]!.level ?? 0) > level) {
      const inner = listLevel(items, i, level + 1, Tag, linkable, levels);
      nested = <Tag style={look}>{inner.nodes}</Tag>;
      i = inner.next;
    }
    nodes.push(
      <li key={key}>
        <RunsView runs={runs} linkable={linkable} />
        {nested}
      </li>,
    );
  }
  return { nodes, next: i };
}

function TextBoxView({ node, path }: NodeProps<TextBoxNode>): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const options = useRenderOptions();
  useTextFit(ref, node.fit, [node]);
  const style = toReactStyle(node.style, { resolveUrl: options.resolveSrc }) as CSSProperties & Record<string, string | number>;
  if (node.indent !== undefined) style['--open-artifact-indent'] = `${node.indent}px`;
  if (node.fit === 'grow') style.flexShrink = 0;
  return (
    <div ref={ref} {...frameOf(node, path, 'open-artifact-textbox', options.builds?.get(path[0]!))} style={style}>
      {node.blocks.map((block, i) => {
        const blockStyle = toReactStyle(block.style);
        if (block.kind === 'text') {
          const Tag = block.tag;
          return (
            <Tag key={i} data-open-artifact-block={i} style={blockStyle}>
              <RunsView runs={block.runs} linkable={options.mode === 'present'} />
            </Tag>
          );
        }
        const Tag = block.tag;
        return (
          <Tag key={i} data-open-artifact-block={i} style={blockStyle}>
            {block.items.map((item, j) => (
              <li key={j}>
                <RunsView runs={item.runs} linkable={options.mode === 'present'} />
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}

function BoxView({ node, path }: NodeProps<Extract<SlideNode, { kind: 'box' }>>): ReactNode {
  const options = useRenderOptions();
  const style = toReactStyle(node.style, { resolveUrl: options.resolveSrc });
  return (
    <div {...frameOf(node, path, node.group ? 'open-artifact-box open-artifact-group' : 'open-artifact-box', options.builds?.get(path[0]!))} style={style}>
      {node.children.map((child, i) => (
        <NodeView key={i} node={child} path={[...path, i]} />
      ))}
    </div>
  );
}

/** The `<img>` inside an image frame, placed by its crop or object-fit. */
function pictureStyle(node: ImageNode): CSSProperties {
  const fit = node.style['object-fit'] ?? 'cover';
  if (node.crop) {
    const { zoom, x, y } = node.crop;
    return {
      position: 'absolute',
      width: `${zoom * 100}%`,
      height: `${zoom * 100}%`,
      left: `${(1 - zoom) * x}%`,
      top: `${(1 - zoom) * y}%`,
      objectFit: 'cover',
      objectPosition: `${x}% ${y}%`,
    };
  }
  return {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: fit as CSSProperties['objectFit'],
    objectPosition: '50% 50%',
  };
}

function ImageView({ node, path }: NodeProps<ImageNode>): ReactNode {
  const options = useRenderOptions();
  const style = toReactStyle(node.style, { omit: new Set(['object-fit']), resolveUrl: options.resolveSrc });
  const sized = Boolean(node.style.height || node.style['aspect-ratio'] || node.style.flex || node.style['flex-grow'] || (node.style.top && node.style.bottom));
  const frame = frameOf(node, path, 'open-artifact-img', options.builds?.get(path[0]!));
  const src = node.src ? options.resolveSrc(node.src) : undefined;
  const key = pathKey(path);
  let media: ReactNode;
  if (node.video && options.mode === 'present') {
    media = <ClipView node={node} clipKey={key} poster={src} />;
  } else if (src) {
    media = <img src={src} alt={node.alt ?? ''} draggable={false} style={sized ? pictureStyle(node) : { width: '100%', height: 'auto', position: 'static' }} />;
  } else if (node.video?.link) {
    const thumb = videoThumbnailUrl(node.video.link);
    media = thumb ? <img src={thumb} alt={node.alt ?? ''} draggable={false} style={pictureStyle(node)} /> : <MediaPlaceholder video />;
  } else if (options.mode === 'edit' || options.mode === 'thumb') {
    media = <MediaPlaceholder video={Boolean(node.video)} />;
  }
  if (!sized && !style.height && !src) style.height = 240;
  return (
    <div {...frame} style={style} role={node.alt ? 'img' : undefined} aria-label={node.alt || undefined}>
      {media}
      {node.video && options.mode === 'edit' ? (
        <span className="open-artifact-clip-badge" aria-hidden>
          <Video size={28} />
        </span>
      ) : null}
    </div>
  );
}

/** A visible stand-in for an empty picture or video frame while editing. */
function MediaPlaceholder({ video }: { video?: boolean }): ReactNode {
  return <span className="open-artifact-media-empty">{video ? <Video size={64} strokeWidth={1.5} /> : <ImageIcon size={64} strokeWidth={1.5} />}</span>;
}

/** A playing clip while presenting: uploaded file or hosted player. */
function ClipView({ node, clipKey, poster }: { node: ImageNode; clipKey: string; poster?: string }): ReactNode {
  const options = useRenderOptions();
  const video = node.video!;
  const waiting = video.startOnClick && !options.startedClips?.has(clipKey);
  const [delayed, setDelayed] = useState(Boolean(video.delay) && !video.startOnClick);
  useEffect(() => {
    if (!delayed || !video.delay) return;
    const timer = setTimeout(() => setDelayed(false), video.delay * 1000);
    return () => clearTimeout(timer);
  }, [delayed, video.delay]);
  // A clip past its wait still needs a free slot: it shows its poster until one opens.
  const slot = useClipSlot(!waiting && !delayed);
  if (waiting || delayed || !slot) {
    return (
      <>
        {poster ? <img src={poster} alt="" style={pictureStyle(node)} /> : null}
        {waiting ? (
          <button
            type="button"
            className="open-artifact-clip-start"
            aria-label="Play video"
            onClick={(e) => {
              e.stopPropagation();
              options.onStartClip?.(clipKey);
            }}
          >
            <Play size={72} />
          </button>
        ) : null}
      </>
    );
  }
  if (video.src) {
    return (
      <video
        src={options.resolveSrc(video.src)}
        poster={poster}
        autoPlay
        playsInline
        muted={!video.sound}
        loop={video.loop !== false}
        style={pictureStyle(node)}
      />
    );
  }
  const url = video.link ? videoEmbedUrl(video.link, typeof location === 'undefined' ? undefined : location.origin) : null;
  if (!url) return null;
  return (
    <iframe
      src={url}
      title={node.alt || 'Video'}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
    />
  );
}

function TableView({ node, path }: NodeProps<TableNode>): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const options = useRenderOptions();
  useTextFit(ref, node.fit, [node]);
  const style = toReactStyle(node.style, { resolveUrl: options.resolveSrc });
  if (node.fit === 'grow') style.flexShrink = 0;
  return (
    <div ref={ref} {...frameOf(node, path, 'open-artifact-tablebox', options.builds?.get(path[0]!))} style={style}>
      <table className="open-artifact-table">
        <tbody>
          {node.rows.map((row, r) => (
            <tr key={r} style={toReactStyle(row.style)}>
              {row.cells.map((cell, c) => {
                const Cell = cell.tag;
                return (
                  <Cell key={c} data-open-artifact-cell={`${r}:${c}`} style={toReactStyle(cell.style)}>
                    <RunsView runs={cell.runs} linkable={options.mode === 'present'} />
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SvgView({ node, path }: NodeProps<SvgNode>): ReactNode {
  const options = useRenderOptions();
  const frame = frameOf(node, path, 'open-artifact-svg', options.builds?.get(path[0]!));
  const html = useMemo(() => {
    const attrs = ` data-open-artifact-path="${frame['data-open-artifact-path']}" data-open-artifact-kind="svg"${frame.className ? ` class="${frame.className}"` : ''} style="${cssText(node.style).replace(/"/g, '&quot;')}"`;
    // SMIL plays only when presenting, with motion allowed and nothing flashing.
    const play = options.mode === 'present' && !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    return guardSmil(node.markup, play).replace(/^<svg/i, `<svg${attrs}`);
  }, [node.markup, node.style, frame['data-open-artifact-path'], frame.className, options.mode]);
  return <span className="open-artifact-contents" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ShapeView({ node, path }: NodeProps<ShapeNode>): ReactNode {
  const options = useRenderOptions();
  const frame = frameOf(node, path, 'open-artifact-shape', options.builds?.get(path[0]!));
  const shape = node.shape;
  if (shape === 'rect' || shape === 'rounded' || shape === 'ellipse') {
    const style = toReactStyle(node.style);
    if (shape === 'ellipse') style.borderRadius = '50%';
    else if (shape === 'rounded' && !node.style['border-radius']) style.borderRadius = 24;
    return <div {...frame} style={style} />;
  }
  const stroke = parseStroke(node.style.border);
  const filters = [node.style.filter, dropShadows(node.style['box-shadow'])].filter(Boolean).join(' ');
  const style = toReactStyle(node.style, { omit: new Set(['background', 'border', 'border-radius', 'box-shadow', 'filter']) });
  if (filters) style.filter = filters;
  style.overflow = 'visible';
  if (shape === 'line') {
    const color = stroke?.color ?? node.style.background ?? 'currentColor';
    const width = stroke?.width ?? 2;
    return (
      <svg {...frame} style={style} viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="0" y1="50" x2="100" y2="50" stroke={color} strokeWidth={width} vectorEffect="non-scaling-stroke" strokeDasharray={dashArray(stroke?.line, width)} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...frame} style={style} viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon
        points={SHAPE_POLYGONS[shape] ?? ''}
        fill={node.style.background ?? 'none'}
        stroke={stroke?.color}
        strokeWidth={stroke?.width}
        strokeDasharray={stroke ? dashArray(stroke.line, stroke.width) : undefined}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function IconView({ node, path }: NodeProps<IconNode>): ReactNode {
  const options = useRenderOptions();
  const Glyph = ICON_GLYPHS[node.name];
  const style = toReactStyle(node.style, { resolveUrl: options.resolveSrc });
  if (!node.style.width) style.width = 64;
  if (!node.style.height) style.height = 64;
  return (
    <div {...frameOf(node, path, 'open-artifact-icon', options.builds?.get(path[0]!))} style={style}>
      <Glyph width="100%" height="100%" strokeWidth={2} aria-hidden />
    </div>
  );
}

function ConnectorView({ node, path }: NodeProps<ConnectorNode>): ReactNode {
  const options = useRenderOptions();
  const ref = useRef<SVGSVGElement>(null);
  const size = useElementSize(ref);
  const pinned = node.points !== undefined;
  const stroke = connectorStroke(node);
  const color = node.style.color ?? 'currentColor';
  const style: CSSProperties = pinned
    ? { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }
    : { ...toReactStyle(node.style, { omit: new Set(['color', 'border-width', 'border-style']) }), display: 'block', overflow: 'visible' };
  if (!pinned && !node.style.width && !node.style.flex && !node.style['flex-grow']) style.width = 96;
  if (!pinned && !node.style.height) style.height = 2 * Math.max(4, Math.ceil(2.2 * stroke) + 1);
  if (node.style.opacity) style.opacity = Number(node.style.opacity);
  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const geometry = w > 0 || h > 0 || pinned ? connectorGeometry(node, w, h) : null;
  return (
    <svg ref={ref} {...frameOf(node, path, 'open-artifact-connector', options.builds?.get(path[0]!))} style={style} viewBox={`0 0 ${Math.max(w, 1)} ${Math.max(h, 1)}`} preserveAspectRatio="none">
      {geometry ? (
        <>
          <path d={polylineData(geometry.points)} fill="none" stroke="transparent" strokeWidth={Math.max(16, stroke + 12)} style={{ pointerEvents: options.mode === 'edit' ? 'stroke' : 'none' }} />
          <path
            d={polylineData(shaftPoints(geometry, stroke))}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dashArray(node.style['border-style'], stroke)}
          />
          {geometry.heads.map((head, i) => {
            const [a, b] = headWings(head, stroke);
            const d = polylineData([a, head.tip, b]);
            return head.kind === 'open' ? (
              <path key={i} d={d} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path key={i} d={`${d} Z`} fill={color} />
            );
          })}
        </>
      ) : null}
    </svg>
  );
}

function EmbedView({ node, path }: NodeProps<EmbedNode>): ReactNode {
  const options = useRenderOptions();
  const frame = frameOf(node, path, 'open-artifact-embed', options.builds?.get(path[0]!));
  const style = toReactStyle(node.style);
  const holder = useRef<HTMLDivElement>(null);
  const capture = options.mode === 'thumb' || options.captureEmbeds === true;
  useLayoutEffect(() => {
    if (capture && holder.current) return mountEmbedStill(holder.current, node);
  }, [capture, node]);
  if (options.mode === 'thumb' || options.mode === 'export') {
    return <div ref={holder} {...frame} style={style} className={`${frame.className ?? ''} open-artifact-embed-still`} />;
  }
  return (
    <iframe
      {...frame}
      title="Embedded page"
      sandbox="allow-scripts"
      srcDoc={embedDocument(node.html)}
      style={{ ...style, pointerEvents: 'none' }}
      tabIndex={-1}
    />
  );
}

function RuleView({ node, path }: NodeProps<Extract<SlideNode, { kind: 'rule' }>>): ReactNode {
  const options = useRenderOptions();
  return <hr {...frameOf(node, path, 'open-artifact-rule', options.builds?.get(path[0]!))} style={toReactStyle(node.style)} />;
}

/** Draws any node (or the editor's override of it). */
export const NodeView = memo(function NodeView({ node, path }: NodeProps): ReactNode {
  const options = useRenderOptions();
  const replaced = options.override?.(node, path);
  if (replaced !== undefined) return replaced;
  switch (node.kind) {
    case 'text':
      return <TextView node={node} path={path} />;
    case 'list':
      return <ListView node={node} path={path} />;
    case 'textbox':
      return <TextBoxView node={node} path={path} />;
    case 'box':
      return <BoxView node={node} path={path} />;
    case 'image':
      return <ImageView node={node} path={path} />;
    case 'table':
      return <TableView node={node} path={path} />;
    case 'svg':
      return <SvgView node={node} path={path} />;
    case 'shape':
      return <ShapeView node={node} path={path} />;
    case 'icon':
      return <IconView node={node} path={path} />;
    case 'connector':
      return <ConnectorView node={node} path={path} />;
    case 'embed':
      return <EmbedView node={node} path={path} />;
    case 'rule':
      return <RuleView node={node} path={path} />;
  }
});

/* -------------------------------------------------------------------------- */
/* Slide                                                                       */
/* -------------------------------------------------------------------------- */

/** Props of {@link SlideView}. */
export interface SlideViewProps {
  slide: Slide;
  options?: RenderOptions;
  className?: string;
  style?: CSSProperties;
  /** Receives the slide's root element. */
  rootRef?: RefObject<HTMLDivElement | null>;
}

/** Path key of the flow root (the section's flow layer). */
export const FLOW_ROOT_KEY = 'flow';

/** Draws one slide at canvas size. */
export const SlideView = memo(function SlideView({ slide, options = DEFAULT_OPTIONS, className, style, rootRef }: SlideViewProps): ReactNode {
  installSlideStyles();
  // One pool of playback slots per presented slide (a new slide starts empty).
  const capacity = useMemo(() => (options.mode === 'present' ? createClipCapacity() : null), [options.mode, slide.id]);
  const sectionStyle = toReactStyle(slide.style, { omit: SECTION_LAYOUT, resolveUrl: options.resolveSrc });
  const flowStyle = toReactStyle(slide.style, { only: SECTION_LAYOUT });
  const firstFlow = slide.children.findIndex((child) => !isPinned(child));
  const flowChildren: ReactNode[] = [];
  slide.children.forEach((child, i) => {
    if (!isPinned(child)) flowChildren.push(<NodeView key={i} node={child} path={[i]} />);
  });
  const layers: ReactNode[] = [];
  slide.children.forEach((child, i) => {
    if (isPinned(child)) layers.push(<NodeView key={i} node={child} path={[i]} />);
    else if (i === firstFlow) {
      layers.push(
        <div key={FLOW_ROOT_KEY} className="open-artifact-flow" data-open-artifact-path={FLOW_ROOT_KEY} style={flowStyle}>
          {flowChildren}
        </div>,
      );
    }
  });
  return (
    <OptionsContext.Provider value={options}>
      <ClipCapacityContext.Provider value={capacity}>
        <div ref={rootRef} className={[SLIDE_CLASS, className].filter(Boolean).join(' ')} data-open-artifact-slide={slide.id} data-open-artifact-mode={options.mode} style={{ ...sectionStyle, ...style }}>
          {layers}
        </div>
      </ClipCapacityContext.Provider>
    </OptionsContext.Provider>
  );
});
