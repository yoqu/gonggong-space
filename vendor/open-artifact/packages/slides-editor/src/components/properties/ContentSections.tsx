/**
 * Element-specific sections of the properties panel: image / video, table,
 * embed, connector, line and icon.
 */

import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, Ban, Minus, Upload } from 'lucide-react';
import {
  CORNERS,
  ICON_NAMES,
  LIMITS,
  VIDEO_PROVIDER_LABELS,
  formatBorder,
  hasHeaderRow,
  parseBorder,
  resizeTable,
  rgbaToHex,
  setHeaderRow,
  setImageCrop,
  setImageFit,
  setImageSource,
  setVideo,
  tableColumns,
  updateNodeAt,
  videoKeepsStart,
  type ConnectorNode,
  type Corner,
  type HeadKind,
  type IconName,
  type ImageNode,
  type NodePath,
  type Route,
  type SlideNode,
  type TableNode,
  type VideoSpec,
} from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { ColorRow, useColorGroups } from './ColorField.tsx';
import { StrokeDashedIcon, StrokeDottedIcon, StrokeSolidIcon } from './icons.tsx';
import { CheckboxInput, IconButton, Note, NumberInput, Row, Section, Segmented, SelectInput, SwitchInput, TextInput } from './kit.tsx';
import { ICON_GLYPHS } from '../../render/icons.tsx';
import { useUi } from '../../state/ui.ts';
import { changeCurrent, updateSelection } from '../../services/commands.ts';
import { pickFiles, posterFromClip, posterFromSite, replaceImage, replacePoster } from '../../services/assets.ts';
import { resolveSrc } from '../../services/session.ts';
import { colorsAt, commitCss, contrastFor, sharedStyle, type Target } from './shared.tsx';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mov';

/** Applies `fn` to the single image at `path`. */
function updateImage(path: NodePath, label: string, fn: (node: ImageNode) => ImageNode, coalesce?: string): void {
  changeCurrent(label, (slide) => updateNodeAt(slide, path, (node) => (node.kind === 'image' ? fn(node) : node)), coalesce ? { coalesce } : {});
}

/** Applies `fn` to every selected image. */
function updateImages(label: string, fn: (node: ImageNode) => ImageNode, coalesce?: string): void {
  updateSelection(label, (node) => (node.kind === 'image' ? fn(node) : node), coalesce ? { coalesce } : undefined);
}

/** True when `node` shows a picture or a clip. */
function hasMedia(node: ImageNode): boolean {
  return Boolean(node.src || node.video);
}

/** Removes the picture and any clip, leaving an empty frame. */
function clearMedia(node: ImageNode): ImageNode {
  return setImageSource(setVideo(node, null), undefined);
}

/* -------------------------------------------------------------------------- */
/* Media source row                                                            */
/* -------------------------------------------------------------------------- */

interface MediaSourceRowProps {
  label: string;
  /** What the field says: the picture's name, "Mixed", or "Add image…" when empty. */
  text: string;
  /** A thumbnail of the picture (not for clips). */
  thumb?: string;
  empty?: boolean;
  /** Why the field can't be used. */
  reason?: string;
  /** Tooltip of the field when it can be used. */
  tip: string;
  onPress: () => void;
  removeLabel?: string;
  onRemove?: () => void;
}

/**
 * A row naming a picture (or clip, or cover): pressing it picks a
 * replacement; the trailing button removes it or, when empty, uploads one.
 */
function MediaSourceRow({ label, text, thumb, empty = false, reason, tip, onPress, removeLabel, onRemove }: MediaSourceRowProps): ReactNode {
  const disabled = reason !== undefined;
  return (
    <Row label={label}>
      <button
        type="button"
        aria-label={empty ? `${label}: none` : `${label}: ${text}`}
        title={reason ?? (empty ? undefined : tip)}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onPress}
        className={cn(
          'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] bg-chrome-field px-1.5 text-left text-[13px] text-chrome-fg outline-none hover:bg-chrome-hover focus-visible:ring-1 focus-visible:ring-chrome-accent',
          disabled && 'cursor-default text-chrome-muted hover:bg-chrome-field',
          empty && 'text-chrome-muted',
        )}
      >
        {!empty && thumb !== undefined ? (
          <span className="size-[18px] shrink-0 overflow-hidden rounded-[4px] border border-chrome-sep bg-chrome">
            {thumb ? <img alt="" src={thumb} className="size-full object-cover" /> : null}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </button>
      {empty ? (
        <IconButton label="Upload image…" icon={<Upload className="size-3.5" />} disabled={disabled} reason={reason} onClick={onPress} />
      ) : onRemove ? (
        <IconButton label={removeLabel ?? 'Remove'} icon={<Minus className="size-3.5" />} onClick={onRemove} />
      ) : null}
    </Row>
  );
}

/** A file-name-like alt text names the picture best. */
function looksLikeFilename(text: string): boolean {
  return /^[^\s/\\]+\.(png|jpe?g|gif|webp|svg|mp4|mov|webm)$/i.test(text.trim());
}

/** What the source row calls the picture or clip. */
function mediaName(node: ImageNode): string {
  const alt = node.alt?.trim() ?? '';
  if (looksLikeFilename(alt)) return alt;
  if (node.video?.link) return `${VIDEO_PROVIDER_LABELS[node.video.link.provider]} video`;
  if (node.video) return 'Uploaded video';
  const file = node.src && !node.src.startsWith('/_blob/') ? node.src.split('/').pop() : undefined;
  if (file) return decodeURIComponent(file);
  const ext = /\.([a-z0-9]+)$/i.exec(node.src ?? '')?.[1];
  return ext ? `${ext.toUpperCase()} image` : 'Image';
}

/* -------------------------------------------------------------------------- */
/* Image / video                                                               */
/* -------------------------------------------------------------------------- */

const SVG_FIT_REASON = "A selected SVG image can't be cropped to fill its frame.";

/** An image or video frame: its source, cover, fit, playback and alt text. */
export function ImageSection({ target }: { target: Target }): ReactNode {
  if (target.nodes.length === 0 || !target.nodes.every((n) => n.kind === 'image')) return null;
  const images = target.nodes as ImageNode[];
  const single = images.length === 1;
  const node = images[0]!;
  const path = target.paths[0]!;
  const video = single ? node.video : undefined;
  const empty = !images.some(hasMedia);
  const isSvg = images.some((n) => /\.svg($|\?)/i.test(n.src ?? ''));
  const fits = images.map((n) => (n.style['object-fit'] === 'contain' ? 'contain' : 'cover'));
  const fit = fits.every((f) => f === fits[0]) ? fits[0]! : null;
  const alts = images.map((n) => n.alt ?? '');
  const sameAlt = alts.every((a) => a === alts[0]);

  const pick = (accept: string, then: (file: File) => void): void => {
    void pickFiles(accept, false).then((files) => {
      if (files[0]) then(files[0]);
    });
  };
  const onPress = (): void => {
    if (video?.link) useUi.getState().open('videoLink');
    else pick(video ? `${VIDEO_ACCEPT},${IMAGE_ACCEPT}` : IMAGE_ACCEPT, (file) => void replaceImage(path, file));
  };

  return (
    <Section title={video ? 'Video' : 'Image'}>
      <MediaSourceRow
        label={video ? 'Video' : 'Image'}
        text={!single ? 'Mixed' : empty ? 'Add image…' : mediaName(node)}
        thumb={video || !node.src ? undefined : resolveSrc(node.src)}
        empty={empty}
        reason={single ? undefined : 'Select one image to replace it'}
        tip={video?.link ? 'Change video link' : video ? 'Replace the video…' : 'Replace the image…'}
        onPress={onPress}
        removeLabel={video ? 'Remove video' : 'Remove image'}
        onRemove={() => updateImages(video ? 'Remove video' : 'Remove image', clearMedia)}
      />
      {video ? <CoverRow node={node} path={path} video={video} /> : null}
      {video?.link && !node.src ? null : (
        <Row label="Fit">
          <Segmented<'cover' | 'contain'>
            aria-label="Image fit"
            value={fit}
            options={[
              { value: 'cover', label: 'Cover', ...(isSvg ? { disabled: true, reason: SVG_FIT_REASON } : {}) },
              { value: 'contain', label: 'Contain' },
            ]}
            onChange={(value) => updateImages('Image fit', (n) => (value === 'cover' && /\.svg($|\?)/i.test(n.src ?? '') ? n : setImageFit(value === 'contain' ? setImageCrop(n, undefined) : n, value)))}
          />
        </Row>
      )}
      {video ? <PlaybackRows path={path} video={video} /> : null}
      <Row label="Alt text">
        <TextInput
          aria-label="Alt text"
          className="min-w-0 flex-1"
          maxLength={LIMITS.alt}
          value={sameAlt ? alts[0]! : ''}
          placeholder={sameAlt ? '' : 'Mixed'}
          onChange={(event) => {
            const alt = event.target.value;
            updateImages('Alt text', (n) => setImageSource(n, n.src, alt), 'alt-text');
          }}
        />
      </Row>
    </Section>
  );
}

/** The cover image of a clip: a frame, the site's thumbnail, or a custom picture. */
function CoverRow({ node, path, video }: { node: ImageNode; path: NodePath; video: VideoSpec }): ReactNode {
  const custom = video.still === 'custom';
  const name = custom ? 'Custom cover image' : !node.src ? 'None' : video.link ? `${VIDEO_PROVIDER_LABELS[video.link.provider]} thumbnail` : 'Video frame';
  return (
    <MediaSourceRow
      label="Cover image"
      text={name}
      thumb={node.src ? resolveSrc(node.src) : ''}
      tip="Set cover image"
      onPress={() => {
        void pickFiles(IMAGE_ACCEPT, false).then((files) => {
          if (files[0]) void replacePoster(path, files[0]);
        });
      }}
      removeLabel="Reset cover image"
      onRemove={custom ? () => void (video.link ? posterFromSite(path) : posterFromClip(path)) : undefined}
    />
  );
}

/** How a clip plays while presenting. */
function PlaybackRows({ path, video }: { path: NodePath; video: VideoSpec }): ReactNode {
  const set = (label: string, patch: Partial<VideoSpec>, coalesce?: string): void => updateImage(path, label, (n) => setVideo(n, patch), coalesce);
  const onClick = Boolean(video.startOnClick);
  return (
    <>
      <Row label="Autoplay" tip="Automatically starts the video when it appears in a presentation.">
        <SwitchInput aria-label="Autoplay" checked={!onClick} onChange={(on) => set('Video autoplay', on ? { startOnClick: undefined } : { startOnClick: true, delay: undefined })} />
      </Row>
      <Row label="Delay">
        <NumberInput
          aria-label="Delay"
          value={onClick ? null : (video.delay ?? 0)}
          unit="s"
          min={0}
          max={60}
          step={0.5}
          disabled={onClick}
          title={onClick ? 'A video that starts on a click has no delay.' : 'Seconds to wait after the slide appears before the video starts.'}
          onCommit={(v) => set('Video delay', { delay: v ? Math.min(60, v) : undefined }, 'video-delay')}
        />
      </Row>
      {video.src ? (
        <>
          <Row label="Loop">
            <SwitchInput aria-label="Loop" checked={video.loop !== false} onChange={(on) => set('Video loop', { loop: on ? undefined : false })} />
          </Row>
          <Row label="Sound">
            <SwitchInput aria-label="Sound" checked={Boolean(video.sound)} onChange={(on) => set('Video sound', { sound: on || undefined })} />
          </Row>
        </>
      ) : null}
      {video.link && videoKeepsStart(video.link.provider) ? (
        <Row label="Start at" tip="Seconds into the video where it starts playing.">
          <NumberInput
            aria-label="Start at"
            value={video.link.start ?? 0}
            unit="s"
            min={0}
            max={86_400}
            onCommit={(v) => set('Video start time', { link: { ...video.link!, start: v ? Math.round(v) : undefined } })}
          />
        </Row>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */

/** Applies `fn` to the single table at `path`. */
/** Changes one table on the current slide (the panel and the floating strip). */
export function updateTable(path: NodePath, label: string, fn: (table: TableNode) => TableNode): void {
  changeCurrent(label, (slide) => updateNodeAt(slide, path, (node) => (node.kind === 'table' ? fn(node) : node)));
}

/** Sets one column's width (percent of the table) on the first row's cell; null makes it auto. */
function setColumnWidth(table: TableNode, col: number, percent: number | null): TableNode {
  return {
    ...table,
    rows: table.rows.map((row, r) =>
      r === 0
        ? {
            ...row,
            cells: row.cells.map((cell, c) => {
              if (c !== col) return cell;
              const style = { ...cell.style };
              if (percent === null) delete style.width;
              else style.width = `${percent}%`;
              return { ...cell, style };
            }),
          }
        : row,
    ),
  };
}

/** A table: columns, rows, column widths and the header row. */
export function TableSection({ target }: { target: Target }): ReactNode {
  const table = target.nodes.length === 1 && target.nodes[0]!.kind === 'table' ? (target.nodes[0] as TableNode) : null;
  if (!table) return null;
  const path = target.paths[0]!;
  const rows = table.rows.length;
  const cols = tableColumns(table);
  const widths = Array.from({ length: cols }, (_, c) => {
    const width = table.rows[0]?.cells[c]?.style.width;
    const percent = width ? /^([\d.]+)%$/.exec(width) : null;
    return { value: percent ? Number(percent[1]) : null, placeholder: width && !percent ? width : 'auto' };
  });

  return (
    <Section title="Table">
      <Row label="Columns">
        <NumberInput aria-label="Columns" value={cols} min={1} max={LIMITS.tableColumns} onCommit={(v) => v && v !== cols && updateTable(path, 'Table columns', (t) => resizeTable(t, rows, v))} />
      </Row>
      <Row label="Rows">
        <NumberInput aria-label="Rows" value={rows} min={1} max={LIMITS.tableRows} onCommit={(v) => v && v !== rows && updateTable(path, 'Table rows', (t) => resizeTable(t, v, cols))} />
      </Row>
      <div className="flex flex-col gap-1 py-1 pl-4 pr-3">
        <div className="text-[12px] text-chrome-muted">Column widths</div>
        <div className="grid grid-cols-2 gap-2">
          {widths.map((width, c) => (
            <NumberInput
              key={c}
              aria-label={`Column ${c + 1} width`}
              label={`Col ${c + 1}`}
              value={width.value}
              placeholder={width.placeholder}
              min={1}
              max={100}
              steppers={false}
              //.
              className="[&_input]:placeholder:text-chrome-fg"
              onCommit={(v) => updateTable(path, 'Column width', (t) => setColumnWidth(t, c, v))}
            />
          ))}
        </div>
      </div>
      <Row label="Header row">
        <CheckboxInput aria-label="Header row" checked={hasHeaderRow(table)} onChange={(on) => updateTable(path, on ? 'Add header row' : 'Remove header row', (t) => setHeaderRow(t, on))} />
      </Row>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Embed                                                                       */
/* -------------------------------------------------------------------------- */

/** An embed: what can (not) be changed here. */
export function EmbedSection({ target }: { target: Target }): ReactNode {
  if (target.nodes.length !== 1 || target.nodes[0]!.kind !== 'embed') return null;
  return (
    <Section title="Embed">
      <Note>This embed’s content is written by the agent — ask the agent in chat to change it.</Note>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Connector                                                                   */
/* -------------------------------------------------------------------------- */

const DIRECTIONS: Record<Corner, { label: string; Icon: typeof ArrowDownRight }> = {
  tl: { label: 'Down-right', Icon: ArrowDownRight },
  tr: { label: 'Down-left', Icon: ArrowDownLeft },
  bl: { label: 'Up-right', Icon: ArrowUpRight },
  br: { label: 'Up-left', Icon: ArrowUpLeft },
};

const HEAD_OPTIONS: { value: HeadKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'open', label: 'Open' },
  { value: 'filled', label: 'Filled' },
];

const ROUTE_OPTIONS: { value: Route; label: string }[] = [
  { value: 'straight', label: 'Straight' },
  { value: 'elbow', label: 'Elbow' },
  { value: 'hv', label: 'Bend: across, then down' },
  { value: 'vh', label: 'Bend: down, then across' },
];

/** One value when every connector agrees, else null (mixed). */
function sharedField<K extends keyof ConnectorNode>(nodes: ConnectorNode[], key: K, fallback: NonNullable<ConnectorNode[K]>): NonNullable<ConnectorNode[K]> | null {
  const values = nodes.map((n) => n[key] ?? fallback);
  return values.every((v) => v === values[0]) ? (values[0] as NonNullable<ConnectorNode[K]>) : null;
}

function setConnector(label: string, patch: Partial<ConnectorNode>): void {
  updateSelection(label, (node) => (node.kind === 'connector' ? ({ ...node, ...patch } as SlideNode) : node));
}

/** A connector: direction, arrowheads, route and dash; then its line's look. */
export function ConnectorSection({ target }: { target: Target }): ReactNode {
  const groups = useColorGroups();
  if (target.nodes.length === 0 || !target.nodes.every((n) => n.kind === 'connector')) return null;
  const nodes = target.nodes as ConnectorNode[];
  const flow = nodes.every((n) => !n.points);
  const style = sharedStyle(target, 'border-style');
  const width = sharedStyle(target, 'border-width');
  const color = sharedStyle(target, 'color');
  const dash = style.mixed ? null : style.value === 'dashed' ? 'dashed' : 'solid';
  const setDash = (value: string): void => {
    commitCss(target, 'border-style', value === 'dashed' ? 'dashed' : '', 'Line style');
  };
  return (
    <>
      <Section title="Connector">
        {flow ? (
          <Row label="Direction">
            <Segmented<Corner>
              aria-label="Direction"
              value={sharedField(nodes, 'from', 'tl')}
              options={CORNERS.map((corner) => {
                const { label, Icon } = DIRECTIONS[corner];
                return { value: corner, title: label, label: <Icon className="size-4" strokeWidth={1.5} /> };
              })}
              onChange={(corner) => updateSelection('Connector direction', (node) => {
                if (node.kind !== 'connector') return node;
                const { from: _from, ...rest } = node;
                return corner === 'tl' ? rest : { ...rest, from: corner };
              })}
            />
          </Row>
        ) : null}
        <Row label="Start">
          <Segmented<HeadKind> aria-label="Start" value={sharedField(nodes, 'headStart', 'none')} options={HEAD_OPTIONS} onChange={(head) => setConnector('Arrowhead', { headStart: head })} />
        </Row>
        <Row label="End">
          <Segmented<HeadKind> aria-label="End" value={sharedField(nodes, 'headEnd', 'none')} options={HEAD_OPTIONS} onChange={(head) => setConnector('Arrowhead', { headEnd: head })} />
        </Row>
        <Row label="Route">
          <SelectInput<Route> aria-label="Route" value={sharedField(nodes, 'route', 'straight')} placeholder="Mixed" options={ROUTE_OPTIONS} onChange={(route) => setConnector('Connector route', { route })} />
        </Row>
        <Row label="Style">
          <Segmented<'solid' | 'dashed'>
            aria-label="Style"
            value={dash}
            options={[
              { value: 'solid', label: 'Solid' },
              { value: 'dashed', label: 'Dashed' },
            ]}
            onChange={setDash}
          />
        </Row>
      </Section>
      <Section title="Appearance">
        <Row label="Line">
          <Segmented<'none' | 'solid' | 'dashed' | 'dotted'>
            aria-label="Line"
            value={dash}
            options={[
              { value: 'none', title: 'None', label: <Ban className="size-3.5" strokeWidth={1.5} />, disabled: true, reason: 'A line always draws' },
              { value: 'solid', title: 'Solid', label: <StrokeSolidIcon /> },
              { value: 'dashed', title: 'Dashed', label: <StrokeDashedIcon /> },
              { value: 'dotted', title: 'Dotted', label: <StrokeDottedIcon />, disabled: true, reason: 'A line is solid or dashed' },
            ]}
            onChange={setDash}
          />
        </Row>
        <ColorRow
          label="Color"
          aria-label="Line color"
          value={color.mixed ? null : (color.value ?? null)}
          mixed={color.mixed}
          effective={rgbaToHex(colorsAt(target.slide, target.paths[0]!).text)}
          emptyLabel="Theme default"
          groups={groups}
          onReset={color.value ? () => commitCss(target, 'color', '', 'Line color') : undefined}
          onCommit={(value) => commitCss(target, 'color', value ?? '', 'Line color', 'line-color')}
        />
        <Row label="Width">
          <NumberInput
            aria-label="Line width"
            value={width.mixed ? null : (Number.parseFloat(width.value ?? '') || null)}
            placeholder={width.mixed ? 'Mixed' : '2'}
            unit="px"
            min={1}
            max={32}
            onCommit={(v) => commitCss(target, 'border-width', v ? `${v}px` : '', 'Line width', 'line-width')}
          />
        </Row>
      </Section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Line                                                                        */
/* -------------------------------------------------------------------------- */

/** A line shape or `<hr>`: thickness and color (lines are solid). */
export function LineSection({ target }: { target: Target }): ReactNode {
  const groups = useColorGroups();
  const isLine = (n: SlideNode): boolean => n.kind === 'rule' || (n.kind === 'shape' && n.shape === 'line');
  if (target.nodes.length === 0 || !target.nodes.every(isLine)) return null;
  const shared = sharedStyle(target, 'border');
  const parsed = shared.value && !shared.mixed ? parseBorder(shared.value, 32) : null;
  const border = parsed?.ok ? parsed.value : { width: 2, style: 'solid' as const, color: '#141413' };
  const commit = (patch: Partial<typeof border>, label: string): void => {
    commitCss(target, 'border', formatBorder({ ...border, ...patch, style: 'solid' }), label, 'line');
  };
  return (
    <Section title="Line">
      <Row label="Thickness">
        <NumberInput aria-label="Thickness" value={shared.mixed ? null : border.width} placeholder="Mixed" unit="px" min={1} max={32} onCommit={(v) => commit({ width: v ?? 2 }, 'Line thickness')} />
      </Row>
      <ColorRow label="Color" aria-label="Line color" value={shared.mixed ? null : border.color} mixed={shared.mixed} groups={groups} onCommit={(color) => color && commit({ color }, 'Line color')} />
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Icon                                                                        */
/* -------------------------------------------------------------------------- */

/** "CheckCircle" → "Check circle". */
function iconLabel(name: IconName): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words[0]!.toUpperCase() + words.slice(1);
}

/** An icon: its glyph and its color. */
export function IconSection({ target }: { target: Target }): ReactNode {
  const groups = useColorGroups();
  if (target.nodes.length === 0 || !target.nodes.every((n) => n.kind === 'icon')) return null;
  const names = target.nodes.map((n) => (n.kind === 'icon' ? n.name : null));
  const glyph = names.every((n) => n === names[0]) ? names[0]! : null;
  const color = sharedStyle(target, 'color');
  const value = color.mixed ? null : (color.value ?? null);
  const effective = rgbaToHex(colorsAt(target.slide, target.paths[0]!).text);
  return (
    <Section title="Icon">
      <Row label="Glyph">
          <SelectInput<IconName>
            aria-label="Glyph"
            value={glyph}
            placeholder="Mixed"
            options={ICON_NAMES.map((name) => {
              const Glyph = ICON_GLYPHS[name];
              return { value: name, label: iconLabel(name), icon: <Glyph size={14} strokeWidth={1.75} /> };
            })}
            onChange={(name) => updateSelection('Icon', (node) => (node.kind === 'icon' ? { ...node, name } : node))}
          />
        </Row>
      <ColorRow
        label="Color"
        aria-label="Icon color"
        value={value}
        mixed={color.mixed}
        effective={effective}
        emptyLabel="Theme default"
        groups={groups}
        contrast={color.mixed ? null : contrastFor(target, { kind: 'icon', color: value ?? effective })}
        onReset={value ? () => commitCss(target, 'color', '', 'Icon color') : undefined}
        onCommit={(next) => commitCss(target, 'color', next ?? '', 'Icon color', 'icon-color')}
      />
    </Section>
  );
}
