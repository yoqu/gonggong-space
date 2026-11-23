/**
 * The editor's dialogs: the new-slide layout picker, scale the selection
 * (K), insert or change a video link, insert a table, the keyboard
 * shortcuts, the PDF and web page download options, "download anyway?"
 * while the agent is still writing the deck, and the notes of the last
 * download (what it could not carry over).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { LAYOUT_IDS, LAYOUT_NAMES, LIMITS, makeLayout, parseVideoUrl, pinnedRectOf, VIDEO_PROVIDER_LABELS, type LayoutId, type VideoProvider } from '@open-artifact/slides-core';
import { Button, Dialog, NumberInput, Segmented, SwitchInput, cn } from '@open-artifact/ui';
import { useSelectedNodes } from '../state/selection.ts';
import { useUi } from '../state/ui.ts';
import { insertVideoLink } from '../services/assets.ts';
import { addSlide, insertTable, scaleSelection } from '../services/commands.ts';
import type { HtmlQuality, PdfQuality } from '../services/exports.ts';
import { session } from '../services/session.ts';
import { answerPartialExport, startExport, useExportUi } from '../services/shell.ts';
import { SlideThumb } from './SlideThumb.tsx';
import { MOD } from '@open-artifact/editor-kit';

/** The dialogs, mounted once by the app. */
export function Dialogs(): ReactNode {
  const dialog = useUi((s) => s.dialog);
  const close = (): void => useUi.getState().close();
  return (
    <>
      {dialog === 'newSlide' ? <NewSlideDialog onClose={close} /> : null}
      {dialog === 'scale' ? <ScaleDialog onClose={close} /> : null}
      {dialog === 'videoLink' ? <VideoLinkDialog onClose={close} /> : null}
      {dialog === 'table' ? <TableDialog onClose={close} /> : null}
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={close} />
      <PdfDialog />
      <HtmlDialog />
      <PartialExportDialog />
      <ExportNotesDialog />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* New slide                                                                   */
/* -------------------------------------------------------------------------- */

/** A layout's preview slide (built once per layout). */
function LayoutPreview({ layout }: { layout: LayoutId }): ReactNode {
  const slide = useMemo(() => makeLayout(layout, `preview-${layout}`), [layout]);
  return <SlideThumb slide={slide} />;
}

/** "New slide": pick a layout; the slide goes after the current one. */
function NewSlideDialog({ onClose }: { onClose: () => void }): ReactNode {
  const pick = (layout: LayoutId): void => {
    onClose();
    addSlide(layout);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="New slide" className="w-[min(34rem,calc(100vw-2rem))]">
      <div role="listbox" aria-label="Layouts" className="mt-3 grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto p-1">
        {LAYOUT_IDS.map((layout, i) => (
          <button
            key={layout}
            type="button"
            role="option"
            aria-selected={false}
            autoFocus={i === 0}
            className="group flex flex-col gap-1.5 rounded-[8px] p-1 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => pick(layout)}
          >
            <span className="block overflow-hidden rounded-[4px] ring-1 ring-line group-hover:ring-line-strong">
              <LayoutPreview layout={layout} />
            </span>
            <span className="px-0.5 text-[13px] text-fg">{LAYOUT_NAMES[layout]}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Scale                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Reads a scale entry: `150%`, `1.5x` / `×1.5`, or a width in px (`800px`,
 * `800`) relative to `width`. Returns the factor, or null.
 */
export function parseScale(text: string, width: number | null): number | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, '');
  let m = /^([\d.]+)%$/.exec(value);
  if (m) return Number(m[1]) / 100 || null;
  m = /^(?:[x×]([\d.]+)|([\d.]+)[x×])$/.exec(value);
  if (m) return Number(m[1] ?? m[2]) || null;
  m = /^([\d.]+)(?:px)?$/.exec(value);
  if (m && width) return Number(m[1]) / width || null;
  return null;
}

function ScaleDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { nodes } = useSelectedNodes();
  const rects = nodes.map(pinnedRectOf).filter((r) => r !== null);
  const width = rects.length === 1 ? rects[0]!.w : null;
  const [text, setText] = useState('100%');
  const factor = parseScale(text, width);
  const valid = factor !== null && factor > 0.01 && factor <= 20;
  const apply = (): void => {
    if (!valid) return;
    scaleSelection(factor);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Scale"
      description={
        rects.length === 0
          ? 'Select an element placed freely on the slide to scale it.'
          : `Scales ${rects.length === 1 ? 'the element' : `${rects.length} elements`} from the top-left corner, text included.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || rects.length === 0} onClick={apply}>
            Scale
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        Percent, multiple{width ? ' or width' : ''}
        <input
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply();
          }}
          placeholder={width ? `150%, 2x or ${Math.round(width)}px` : '150% or 2x'}
          className={cn('h-8 rounded-control border bg-canvas px-2 text-[13px] text-fg outline-none focus:border-accent', valid || !text ? 'border-line' : 'border-danger')}
        />
      </label>
      {valid && width ? <p className="mt-2 text-xs text-fg-muted">New width: {Math.round(width * factor)} px</p> : null}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Video link                                                                  */
/* -------------------------------------------------------------------------- */

function VideoLinkDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { paths, nodes } = useSelectedNodes();
  const target = nodes.length === 1 && nodes[0]!.kind === 'image' ? paths[0] : undefined;
  const existing = target && nodes[0]!.kind === 'image' ? nodes[0]!.video?.link : undefined;
  const [text, setText] = useState('');
  const link = text.trim() ? parseVideoUrl(text.trim()) : null;
  const providers = (Object.keys(VIDEO_PROVIDER_LABELS) as VideoProvider[]).map((p) => VIDEO_PROVIDER_LABELS[p]).join(', ');
  const apply = (): void => {
    if (!link) return;
    if (insertVideoLink(text, target)) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={existing ? 'Change video link' : 'Insert video link'}
      description={`Paste a link from ${providers}. The video plays on the slide while presenting.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!link} onClick={apply}>
            {existing ? 'Change' : 'Insert'}
          </Button>
        </>
      }
    >
      <input
        autoFocus
        type="url"
        value={text}
        aria-label="Video link"
        placeholder="https://"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply();
        }}
        className={cn('h-8 w-full rounded-control border bg-canvas px-2 text-[13px] text-fg outline-none focus:border-accent', !text.trim() || link ? 'border-line' : 'border-danger')}
      />
      <p className="mt-2 min-h-4 text-xs text-fg-muted">
        {!text.trim() ? '' : link ? `${VIDEO_PROVIDER_LABELS[link.provider]} video${link.start ? `, from ${link.start}s` : ''}` : "This link isn't a video this deck can play."}
      </p>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Table                                                                       */
/* -------------------------------------------------------------------------- */

/** Size of the hover picker. */
const PICKER = 8;

function TableDialog({ onClose }: { onClose: () => void }): ReactNode {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const insert = (r: number, c: number): void => {
    insertTable(r, c);
    onClose();
  };
  const [shownR, shownC] = hover ?? [rows, cols];
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Insert table"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => insert(rows, cols)}>
            Insert
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div role="grid" aria-label="Table size" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${PICKER}, 1.25rem)` }} onPointerLeave={() => setHover(null)}>
          {Array.from({ length: PICKER * PICKER }, (_, i) => {
            const r = Math.floor(i / PICKER) + 1;
            const c = (i % PICKER) + 1;
            const on = r <= shownR && c <= shownC;
            return (
              <button
                key={i}
                type="button"
                aria-label={`${r} × ${c}`}
                className={cn('size-5 rounded-[3px] border', on ? 'border-accent bg-accent-soft' : 'border-line bg-canvas')}
                onPointerEnter={() => setHover([r, c])}
                onClick={() => insert(r, c)}
              />
            );
          })}
        </div>
        <div className="text-xs tabular-nums text-fg-muted">
          {shownR} × {shownC}
        </div>
        <div className="flex items-center gap-2">
          <NumberInput label="Rows" value={rows} min={1} max={LIMITS.tableRows} step={1} onCommit={(v) => v !== null && setRows(Math.round(v))} className="w-24" />
          <span className="text-fg-subtle">×</span>
          <NumberInput label="Columns" value={cols} min={1} max={LIMITS.tableColumns} step={1} onCommit={(v) => v !== null && setCols(Math.round(v))} className="w-24" />
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Shortcuts                                                                   */
/* -------------------------------------------------------------------------- */

const SHORTCUTS: ReadonlyArray<{ group: string; rows: ReadonlyArray<[string, string]> }> = [
  {
    group: 'Slides',
    rows: [
      [`${MOD}M`, 'New slide'],
      [`${MOD}\\`, 'Show or hide the properties panel'],
      [`${MOD}D`, 'Duplicate'],
      ['⌫', 'Delete'],
      ['PgUp / PgDn', 'Previous / next slide'],
      [`⌥${MOD}L`, "Copy the slide's link"],
      [`${MOD}Enter / ⇧${MOD}Enter`, 'Present from this slide / from the start'],
    ],
  },
  {
    group: 'Elements',
    rows: [
      [`${MOD}A`, 'Select all'],
      ['Tab / ⇧Tab', 'Next / previous element'],
      ['Enter / ⇧Enter', 'Into a group or text / back out'],
      ['Arrows', 'Move 8 px (Shift: 1 px)'],
      [`${MOD}G / ⇧${MOD}G`, 'Group / ungroup'],
      ['] / [', 'Bring to front / send to back'],
      ['⌥A ⌥H ⌥D', 'Align left, horizontal centers, right'],
      ['⌥W ⌥V ⌥S', 'Align top, vertical centers, bottom'],
      [`⌥${MOD}C / ⌥${MOD}V`, 'Copy / paste style'],
      ['K', 'Scale…'],
      ['T R ⇧R O D L ⇧L', 'Text, rectangle, rounded, ellipse, diamond, line, connector'],
      ['Esc', 'Cancel tool, end editing, clear selection'],
    ],
  },
  {
    group: 'View',
    rows: [
      [`${MOD}F, ${MOD}G, F3`, 'Find, next match'],
      [`${MOD}= ${MOD}- ${MOD}0`, 'Zoom in / out / fit'],
      ['C', 'Comment mode'],
      ['F6', 'Focus the formatting toolbar'],
      [`${MOD}Z / ⇧${MOD}Z`, 'Undo / redo'],
      ['?', 'Keyboard shortcuts'],
    ],
  },
  {
    group: 'Presenting',
    rows: [
      ['→ ↓ Space', 'Next build or slide'],
      ['← ↑', 'Previous'],
      ['Home / End', 'First / last slide'],
      ['1–9', 'Go to slide'],
      ['F', 'Full screen'],
      ['Esc', 'Stop presenting'],
    ],
  },
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Keyboard shortcuts" className="w-[min(40rem,calc(100vw-2rem))]">
      <div className="grid max-h-[65vh] gap-5 overflow-y-auto sm:grid-cols-2">
        {SHORTCUTS.map(({ group, rows }) => (
          <section key={group}>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{group}</h3>
            <dl className="flex flex-col gap-1">
              {rows.map(([keys, action]) => (
                <div key={keys + action} className="flex items-baseline gap-3 text-xs">
                  <dt className="w-32 shrink-0 font-mono text-[11px] text-fg">{keys}</dt>
                  <dd className="text-fg-muted">{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Downloads                                                                   */
/* -------------------------------------------------------------------------- */

/** PDF options: picture quality and speaker notes. */
function PdfDialog(): ReactNode {
  const pdf = useExportUi((s) => s.pdf);
  const [quality, setQuality] = useState<PdfQuality>('better');
  const [notes, setNotes] = useState(false);
  const close = (): void => {
    if (pdf) session().shell?.exportState(pdf.request, 'declined');
    useExportUi.getState().closePdf();
  };
  return (
    <Dialog
      open={pdf !== null}
      onOpenChange={(open) => !open && close()}
      title="Download PDF"
      description="Each slide becomes a page with selectable, searchable text and working links."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!pdf) return;
              const { request } = pdf;
              useExportUi.getState().closePdf();
              void startExport({ format: 'pdf', quality, notes }, request);
            }}
          >
            Download
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-muted">Picture quality</span>
          <Segmented<PdfQuality>
            value={quality}
            options={[
              { value: 'good', label: 'Good' },
              { value: 'better', label: 'Better' },
              { value: 'best', label: 'Best' },
            ]}
            onChange={setQuality}
          />
          <span className="text-[11px] text-fg-subtle">Higher quality makes a larger file.</span>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <SwitchInput checked={notes} onChange={setNotes} aria-label="Include speaker notes" />
          Include speaker notes
        </label>
      </div>
    </Dialog>
  );
}

/** Web page options: picture quality. */
function HtmlDialog(): ReactNode {
  const html = useExportUi((s) => s.html);
  const [quality, setQuality] = useState<HtmlQuality>('best');
  const close = (): void => {
    if (html) session().shell?.exportState(html.request, 'declined');
    useExportUi.getState().closeHtml();
  };
  return (
    <Dialog
      open={html !== null}
      onOpenChange={(open) => !open && close()}
      title="Download web page"
      description="One file that presents the deck in any browser, with builds, transitions and videos."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!html) return;
              const { request } = html;
              useExportUi.getState().closeHtml();
              void startExport({ format: 'html', quality }, request);
            }}
          >
            Download
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">Picture quality</span>
        <Segmented<HtmlQuality>
          value={quality}
          options={[
            { value: 'good', label: 'Good' },
            { value: 'better', label: 'Better' },
            { value: 'best', label: 'Best' },
          ]}
          onChange={setQuality}
        />
        <span className="text-[11px] text-fg-subtle">Best keeps images as they are. Better and Good shrink large images to make a smaller file.</span>
      </div>
    </Dialog>
  );
}

/** "Only x of y slides so far": a download asked for while the agent is still writing the deck. */
function PartialExportDialog(): ReactNode {
  const partial = useExportUi((s) => s.partial);
  const written = partial?.progress.written ?? 0;
  const planned = partial?.progress.planned ?? 0;
  return (
    <Dialog
      open={partial !== null}
      onOpenChange={(open) => !open && answerPartialExport(false)}
      title="The deck is still being written"
      description={`Only ${written} of ${planned} slides are written so far. The download will have just those.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => answerPartialExport(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => answerPartialExport(true)}>
            Download anyway
          </Button>
        </>
      }
    >
      <p className="text-xs text-fg-muted">Wait for the agent to finish to get every slide.</p>
    </Dialog>
  );
}

/** What the last download could not carry over. */
function ExportNotesDialog(): ReactNode {
  const result = useExportUi((s) => s.notes);
  const close = (): void => useExportUi.getState().setNotes(null);
  return (
    <Dialog
      open={result !== null}
      onOpenChange={(open) => !open && close()}
      title={result?.name ?? ''}
      description={result && result.name !== 'Download failed' ? 'Downloaded. A few things were adjusted on the way:' : undefined}
      footer={
        <Button variant="primary" onClick={close}>
          OK
        </Button>
      }
    >
      <ul className="flex max-h-[50vh] list-disc flex-col gap-1 overflow-y-auto pl-5 text-xs text-fg-muted">
        {result?.notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ul>
    </Dialog>
  );
}
