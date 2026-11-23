/**
 * The text format strip: a small toolbar that floats next to the selected
 * text element, and stays while it is typed into.
 *
 * It holds the text style, the color, bold / italic / underline, the link,
 * the alignment and the list kind, then Properties; a selected
 * table has its rows and columns instead.
 * the properties panel is closed. While typing with text selected, the marks, the color and the
 * link apply to the selected text (the browser's editing commands, read back
 * by the editor); otherwise they apply to the whole element.
 *
 * It sits 10px above the selection, or below it when there is no room (see
 * `lib/floating.ts`), left-aligned with it and kept inside the visible
 * stage, clear of the floating cards. It hides while the selection is moved,
 * resized or drawn over. F6 moves the focus into it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  Bold,
  ChevronDown,
  Ellipsis,
  Italic,
  Link2,
  List,
  ListOrdered,
  Underline,
  Unlink,
} from 'lucide-react';
import { LIMITS, isSafeHref, isTextual, nodeHasMark, nodeUniformLink, resizeTable, setListKind, setNodeMark, tableColumns, toggleNodeMark, type NodePath, type SlideNode, type TableNode } from '@open-artifact/slides-core';
import { Popover } from '@open-artifact/ui';
import { useSelectedNodes } from '../state/selection.ts';
import { useView } from '../state/view.ts';
import { ALIGN_KEYS, alignRefusal, alignSelection, canChange, patchSelectionStyle, updateSelection, type AlignEdge } from '../services/commands.ts';
import { placeFloatingLeft, placeFloatingToolbar } from '../lib/floating.ts';
import { activeEditor, editorHasMark, editorSelectionCollapsed, focusEditor, formatEditor } from './TextEditor.tsx';
import { useStageGesture } from './stage/store.ts';
import { ColorPanel, useColorGroups } from './properties/ColorField.tsx';
import { Button, NumberInput, TextInput } from './properties/kit.tsx';
import { updateTable } from './properties/ContentSections.tsx';
import { useTextStyleMenu } from './properties/shared.tsx';
import { CHROME_CARD, CHROME_INSET } from './StageChrome.tsx';
import { ALT, Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ChromeMenuSeparator, MOD, Tip } from '@open-artifact/editor-kit/react';

/** Height of the strip, px. */
const STRIP_HEIGHT = 40;

/** Room the rotation handle takes above a selected element, px. */
const ROTATE_HANDLE = 36;

/** How far from the strip's ends the rotation handle still counts as under it, px. */
const HANDLE_CLEARANCE = 16;

const ICON = { className: 'size-4', strokeWidth: 1.75 } as const;

const ALIGNS = [
  ['left', 'Align left', AlignLeft],
  ['center', 'Center', AlignCenter],
  ['right', 'Align right', AlignRight],
  ['justify', 'Justify', AlignJustify],
] as const;

type Align = (typeof ALIGNS)[number][0];

/** Aligning several elements to each other, in two rows: across, then down. */
const ITEM_ALIGNS = [
  [
    ['left', 'Align left', AlignStartVertical],
    ['center', 'Align horizontal centers', AlignCenterVertical],
    ['right', 'Align right', AlignEndVertical],
  ],
  [
    ['top', 'Align top', AlignStartHorizontal],
    ['middle', 'Align vertical centers', AlignCenterHorizontal],
    ['bottom', 'Align bottom', AlignEndHorizontal],
  ],
] as const satisfies readonly (readonly (readonly [AlignEdge, string, unknown])[])[];

/** True when a node has text the strip formats. */
function hasText(node: SlideNode): boolean {
  return isTextual(node) || node.kind === 'table';
}

/** True when marks should go to the text selected in the editor. */
function onSelectedText(): boolean {
  return Boolean(activeEditor()) && !editorSelectionCollapsed();
}

/** Puts the focus back into the text being typed after a menu or popover closes. */
function refocusEditor(): void {
  // After the popup has handed the focus back to its trigger.
  setTimeout(() => {
    if (activeEditor()) focusEditor();
  }, 0);
}

/** Buttons of the strip must not take the focus (and the selection) from the text. */
function keepTextFocus(event: MouseEvent): void {
  const target = event.target as Element;
  if (activeEditor() && !target.closest('input, textarea, [contenteditable]')) event.preventDefault();
}

/** Re-renders on caret moves (the B / I / U state follows the caret). */
function useSelectionTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((n) => n + 1);
    document.addEventListener('selectionchange', bump);
    return () => document.removeEventListener('selectionchange', bump);
  }, []);
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                   */
/* -------------------------------------------------------------------------- */

/** The selection's box and the visible band of the stage, in client px. */
interface Anchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  band: { left: number; right: number; top: number; bottom: number };
}

function sameAnchor(a: Anchor | null, b: Anchor | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom && a.band.left === b.band.left && a.band.right === b.band.right && a.band.top === b.band.top && a.band.bottom === b.band.bottom;
}

/** Measures the selected elements (or the editor) against the stage. */
function measureAnchor(paths: readonly NodePath[]): Anchor | null {
  const stage = document.querySelector<HTMLElement>('[data-open-artifact-stage]');
  if (!stage) return null;
  const editor = activeEditor();
  const elements = editor ? [editor] : paths.map((p) => stage.querySelector<HTMLElement>(`[data-open-artifact-path="${p.join('.')}"]`)).filter((el): el is HTMLElement => el !== null);
  if (elements.length === 0) return null;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
  }
  const s = stage.getBoundingClientRect();
  return {
    left: Math.round(left),
    right: Math.round(right),
    top: Math.round(top),
    bottom: Math.round(bottom),
    // The top cards and the bottom toolbar float over the stage: stay between them.
    band: { left: Math.round(s.left), right: Math.round(s.right), top: Math.round(s.top + CHROME_INSET + CHROME_CARD), bottom: Math.round(s.bottom - CHROME_CARD - CHROME_INSET) },
  };
}

/** Follows the selection on screen (scrolling, zooming, typing, moving) every frame. */
function useAnchor(paths: readonly NodePath[] | null): Anchor | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const key = paths ? paths.map((p) => p.join('.')).join(',') : null;
  useLayoutEffect(() => {
    if (!paths) {
      setAnchor(null);
      return;
    }
    let frame = 0;
    const tick = (): void => {
      const next = measureAnchor(paths);
      setAnchor((prev) => (sameAnchor(prev, next) ? prev : next));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
    // `key` stands for `paths` (a new array on every render).
  }, [key]);
  return anchor;
}

/** The caret's box while typing. */
function caretBox(): { top: number; bottom: number } | null {
  const selection = window.getSelection();
  if (!activeEditor() || !selection?.rangeCount) return null;
  const rects = selection.getRangeAt(0).getClientRects();
  const r = rects.length ? rects[rects.length - 1]! : selection.getRangeAt(0).getBoundingClientRect();
  return r.height ? { top: r.top, bottom: r.bottom } : null;
}

/* -------------------------------------------------------------------------- */
/* The strip                                                                   */
/* -------------------------------------------------------------------------- */

/** The floating strip (renders nothing unless text is selected on the stage). */
export function FormatBar(): ReactNode {
  const { slide, paths, nodes, readOnly } = useSelectedNodes();
  const textEdit = useView((s) => s.textEdit);
  const tool = useView((s) => s.tool);
  const cropping = useView((s) => s.cropping);
  const gesturing = useStageGesture((s) => Boolean(s.move || s.draft || s.marquee || s.draw));
  //.
  const showProperties = useView((s) => s.showProperties);
  const visible = !readOnly && canChange() && !showProperties && nodes.length > 0 && nodes.every(hasText) && tool === 'select' && !cropping && !gesturing;
  const anchor = useAnchor(visible ? paths : null);
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (strip.current) setWidth(strip.current.offsetWidth);
  });

  if (!visible || !anchor || !slide) return null;
  const { band } = anchor;
  // Scrolled out of view: hide rather than pin to an edge.
  if (anchor.bottom < band.top || anchor.top > band.bottom) return null;
  const left = placeFloatingLeft(anchor.left, width, band.left, band.right);
  //. A selected element
  // (not being typed into) has a rotation handle above its middle: when the
  // strip would cover it, the strip goes above the handle instead.
  const handle = (anchor.left + anchor.right) / 2;
  const lift = !textEdit && nodes.length === 1 && handle >= left - HANDLE_CLEARANCE && handle <= left + width + HANDLE_CLEARANCE ? ROTATE_HANDLE : 0;
  const { top } = placeFloatingToolbar({
    selTop: anchor.top - lift,
    selBottom: anchor.bottom,
    menuH: STRIP_HEIGHT,
    bandTop: band.top,
    bandBottom: band.bottom,
    caret: caretBox,
  });

  return (
    <div
      ref={strip}
      data-open-artifact-format-bar
      className="pointer-events-none fixed z-30 flex"
      style={{ left, top, maxWidth: band.right - band.left - 16 }}
    >
      {nodes.length === 1 && nodes[0]!.kind === 'table' && !textEdit ? (
        <TableStrip table={nodes[0] as TableNode} path={paths[0]!} />
      ) : (
        <Strip nodes={nodes} />
      )}
    </div>
  );
}

/** The controls. */
function Strip({ nodes }: { nodes: SlideNode[] }): ReactNode {
  useSelectionTick();
  const editing = useView((s) => s.textEdit !== null);
  const single = nodes.length === 1 ? nodes[0]! : null;
  const textNode = single?.kind === 'text' ? single : null;
  const styleMenu = useTextStyleMenu(textNode);
  const first = nodes[0]!;
  const align = (first.style['text-align'] ?? 'left') as Align;
  const alignSame = nodes.every((n) => (n.style['text-align'] ?? 'left') === align);
  const AlignIcon = ALIGNS.find(([value]) => value === align)?.[2] ?? AlignLeft;
  const listKind = single?.kind === 'list' ? single.tag : null;

  const mark = (key: 'b' | 'i' | 'u'): void => {
    if (onSelectedText()) formatEditor(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
    else updateSelection(key === 'b' ? 'Bold' : key === 'i' ? 'Italic' : 'Underline', (node) => toggleNodeMark(node, key));
  };
  const markOn = (key: 'b' | 'i' | 'u'): boolean =>
    editing && activeEditor() ? editorHasMark(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline') : nodes.every((n) => nodeHasMark(n, key));
  const setList = (kind: 'ul' | 'ol' | null): void => {
    updateSelection('List', (node) => (node.kind === 'text' || node.kind === 'list' ? setListKind(node, kind) : node));
    refocusEditor();
  };

  return (
    <Card role="toolbar" aria-label="Text format" className="h-10 min-w-0 gap-0.5 overflow-x-auto px-1 [scrollbar-width:none]" onMouseDown={keepTextFocus}>
      {textNode ? (
        <>
          <ChromeMenu
            tip={{ label: 'Text style' }}
            trigger={
              <ChromeButton aria-label="Text style" className="max-w-[148px] gap-0.5 pl-2 pr-1">
                <span className="min-w-0 truncate">{styleMenu.options.find((o) => o.value === styleMenu.value)?.label ?? 'Custom'}</span>
                <ChevronDown className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
              </ChromeButton>
            }
          >
            {styleMenu.options.map((option) => (
              <ChromeMenuItem
                key={option.value}
                checked={option.value === styleMenu.value}
                onSelect={() => {
                  styleMenu.apply(option.value);
                  refocusEditor();
                }}
              >
                {option.label}
              </ChromeMenuItem>
            ))}
          </ChromeMenu>
          <ChromeDivider />
        </>
      ) : null}
      <TextColor value={first.style.color ?? null} />
      <Tip label="Bold" shortcut={`${MOD}B`}>
        <ChromeButton square aria-label="Bold" pressed={markOn('b')} onClick={() => mark('b')}>
          <Bold {...ICON} />
        </ChromeButton>
      </Tip>
      <Tip label="Italic" shortcut={`${MOD}I`}>
        <ChromeButton square aria-label="Italic" pressed={markOn('i')} onClick={() => mark('i')}>
          <Italic {...ICON} />
        </ChromeButton>
      </Tip>
      <Tip label="Underline" shortcut={`${MOD}U`}>
        <ChromeButton square aria-label="Underline" pressed={markOn('u')} onClick={() => mark('u')}>
          <Underline {...ICON} />
        </ChromeButton>
      </Tip>
      <LinkButton node={single} />
      <ChromeDivider />
      <ChromeMenu
        tip={{ label: 'Alignment' }}
        trigger={
          <ChromeButton aria-label="Alignment" className="gap-0 pl-1.5 pr-0.5">
            <AlignIcon {...ICON} />
            <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
          </ChromeButton>
        }
      >
        {ALIGNS.map(([value, label, Icon]) => (
          <ChromeMenuItem
            key={value}
            checked={alignSame && align === value}
            icon={<Icon className="size-4" />}
            onSelect={() => {
              patchSelectionStyle('Align', { 'text-align': value === 'left' ? undefined : value });
              refocusEditor();
            }}
          >
            {label}
          </ChromeMenuItem>
        ))}
      </ChromeMenu>
      {nodes.length > 1 ? <AlignItems nodes={nodes} /> : null}
      {single && (single.kind === 'text' || single.kind === 'list') ? (
        <ChromeMenu
          tip={{ label: 'List' }}
          trigger={
            <ChromeButton aria-label="List" pressed={listKind !== null} className="gap-0 pl-1.5 pr-0.5">
              {listKind === 'ol' ? <ListOrdered {...ICON} /> : <List {...ICON} />}
              <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
            </ChromeButton>
          }
        >
          <ChromeMenuItem checked={listKind === null} onSelect={() => setList(null)}>
            No list
          </ChromeMenuItem>
          <ChromeMenuItem checked={listKind === 'ul'} icon={<List className="size-4" />} onSelect={() => setList('ul')}>
            Bulleted list
          </ChromeMenuItem>
          <ChromeMenuItem checked={listKind === 'ol'} icon={<ListOrdered className="size-4" />} onSelect={() => setList('ol')}>
            Numbered list
          </ChromeMenuItem>
        </ChromeMenu>
      ) : null}
      <ChromeDivider />
      <PropertiesButton />
    </Card>
  );
}

/** The strip shows while the properties panel is closed. */
function PropertiesButton(): ReactNode {
  return (
    <Tip label="Open the Properties panel" shortcut={`${MOD}\\`}>
      <ChromeButton square aria-label="Properties" onClick={() => useView.getState().toggle('showProperties', true)}>
        <Ellipsis {...ICON} />
      </ChromeButton>
    </Tip>
  );
}

/** Rows (three lines across). */
function RowsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" aria-hidden="true">
      <path d="M3.865 4H12.135M3.865 8H12.135M3.865 12H12.135" />
    </svg>
  );
}

/** Columns (three lines down). */
function ColumnsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" aria-hidden="true">
      <path d="M4 3.865V12.135M8 3.865V12.135M12 3.865V12.135" />
    </svg>
  );
}

/** A selected table (not a cell being typed into): its rows and columns, then the actions. */
function TableStrip({ table, path }: { table: TableNode; path: NodePath }): ReactNode {
  const rows = table.rows.length;
  const cols = tableColumns(table);
  return (
    <Card role="toolbar" aria-label="Table" className="h-10 min-w-0 gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <NumberInput
        aria-label="Rows"
        title="Rows. Fewer rows drop the bottom rows’ text (undoable)"
        label={<RowsIcon />}
        value={rows}
        min={1}
        max={LIMITS.tableRows}
        className="w-[76px] shrink-0"
        onCommit={(v) => v && v !== rows && updateTable(path, 'Table rows', (t) => resizeTable(t, v, tableColumns(t)))}
      />
      <NumberInput
        aria-label="Columns"
        title="Columns. Fewer columns drop the rightmost columns’ text (undoable)"
        label={<ColumnsIcon />}
        value={cols}
        min={1}
        max={LIMITS.tableColumns}
        className="w-[76px] shrink-0"
        onCommit={(v) => v && v !== cols && updateTable(path, 'Table columns', (t) => resizeTable(t, t.rows.length, v))}
      />
      <ChromeDivider />
      <PropertiesButton />
    </Card>
  );
}

/** Aligning the selected elements to each other (⌥A/H/D/W/V/S). */
function AlignItems({ nodes }: { nodes: SlideNode[] }): ReactNode {
  const refused = alignRefusal(nodes);
  if (refused) {
    return (
      <Tip label={`Align items. ${refused}`}>
        <ChromeButton square aria-label="Align items" disabled>
          <AlignStartVertical {...ICON} />
        </ChromeButton>
      </Tip>
    );
  }
  return (
    <ChromeMenu
      tip={{ label: 'Align items' }}
      trigger={
        <ChromeButton aria-label="Align items" className="gap-0 pl-1.5 pr-0.5">
          <AlignStartVertical {...ICON} />
          <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      {ITEM_ALIGNS.map((row, i) => [
        i > 0 ? <ChromeMenuSeparator key={`sep${i}`} /> : null,
        ...row.map(([edge, label, Icon]) => (
          <ChromeMenuItem key={edge} icon={<Icon className="size-4" />} shortcut={`${ALT}${ALIGN_KEYS[edge]}`} onSelect={() => alignSelection(edge)}>
            {label}
          </ChromeMenuItem>
        )),
      ])}
    </ChromeMenu>
  );
}

/** Text color: of the selected text while typing, else of the element. */
function TextColor({ value }: { value: string | null }): ReactNode {
  const groups = useColorGroups();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      side="bottom"
      align="start"
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) refocusEditor();
      }}
      trigger={
        <ChromeButton square aria-label="Text color" title="Text color" className="flex-col gap-0">
          <span className="text-[14px] font-semibold leading-none">A</span>
          <span className="mt-0.5 h-[3px] w-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: value ?? 'currentColor' }} />
        </ChromeButton>
      }
    >
      <div data-open-artifact-format-bar className="w-60">
        <ColorPanel
          value={value}
          groups={groups}
          onClose={() => {
            setOpen(false);
            refocusEditor();
          }}
          onPick={(color) => {
            if (!color) return;
            if (onSelectedText()) {
              // Coloring a run puts focus back in the text, so the popover
              // closes with it: otherwise Escape would end the edit under it.
              formatEditor('foreColor', color);
              setOpen(false);
            } else patchSelectionStyle('Text color', { color }, { coalesce: 'text-color' });
          }}
        />
      </div>
    </Popover>
  );
}

/** Adds or removes a link (http and https only). */
function LinkButton({ node }: { node: SlideNode | null }): ReactNode {
  const [open, setOpen] = useState(false);
  const current = node ? nodeUniformLink(node) : undefined;
  const [url, setUrl] = useState(current ?? '');
  const valid = isSafeHref(url.trim());
  const apply = (): void => {
    const href = url.trim();
    if (!isSafeHref(href)) return;
    if (onSelectedText()) formatEditor('createLink', href);
    else updateSelection('Link', (n) => setNodeMark(n, 'href', href));
    setOpen(false);
  };
  const remove = (): void => {
    if (activeEditor()) formatEditor('unlink');
    else updateSelection('Remove link', (n) => setNodeMark(n, 'href', undefined));
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      side="bottom"
      align="start"
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUrl(current ?? '');
        else refocusEditor();
      }}
      trigger={
        <ChromeButton square aria-label="Link" title={`Link (${MOD}K)`} pressed={Boolean(current)}>
          <Link2 {...ICON} />
        </ChromeButton>
      }
    >
      <div data-open-artifact-format-bar className="flex w-72 flex-col gap-2">
        <TextInput
          autoFocus
          aria-label="Link address"
          placeholder="https://"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
        />
        {url.trim() && !valid ? <p className="text-[12px] text-danger">Links must start with http:// or https://</p> : null}
        <div className="flex justify-end gap-1">
          {current ? (
            <Button size="sm" variant="ghost" icon={<Unlink className="size-3.5" />} onClick={remove}>
              Remove
            </Button>
          ) : null}
          <Button size="sm" variant="primary" disabled={!valid} onClick={apply}>
            Apply
          </Button>
        </div>
      </div>
    </Popover>
  );
}
