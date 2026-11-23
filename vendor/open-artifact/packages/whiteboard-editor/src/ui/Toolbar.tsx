/**
 * The tool bar at the foot of the board and its trays.
 *
 * Left to right: Select, Hand, then (for editors) Text, Section, Note,
 * Draw, Shapes, Stickers; the standalone comment toggle; and pinned at the right end,
 * past a divider, the "Ask <agent>" pill. A viewer gets Select and Hand only.
 *
 * Draw and Shapes remember their last pick; while one of their tools is on,
 * a tray above the bar offers the rest (pen/arrow and ink colors; every
 * shape kind and the table). Clicking the active tool again puts it down.
 */

import { MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  INK_COLOR_NAMES,
  SHAPE_KIND_LABELS,
  capitalizeFirstLetter,
  themedInkColor,
  type HexColor,
} from '@open-artifact/whiteboard-core';
import { DRAW_TOOLS, MORE_SHAPE_KINDS, BASIC_SHAPE_KINDS, shapesButtonTools, toolPickForShapeKind, modKey, toolShortcutKey, type ToolName, type ToolPick } from '../lib/tools.ts';
import { addBoardInk, removeBoardInk } from '../services/commands.ts';
import { insertFiles } from '../services/files.ts';
import { useAgent } from '../services/agent.ts';
import { maybeSession } from '../services/session.ts';
import { useAsk } from '../state/ask.ts';
import { useBoard } from '../state/board.ts';
import { usePreferences } from '../state/preferences.ts';
import { useColorScheme } from '../state/theme.ts';
import { useTool, type StickerChoice } from '../state/tool.ts';
import { useNarrowTouch } from './hooks.ts';
import { ShapeKindIcon, TOOL_ICONS, ToolPickIcon, toolPickLabel } from './icons.tsx';
import { StickerPicker } from './StickerPicker.tsx';
import { Card, ChromeButton, ChromeDivider, ChromePopover, SwatchRow, Tip, TipGroup, ToolButton, type Swatch } from './chrome.tsx';

/** File types the picture picker accepts. */
export const PICTURE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif,image/bmp,video/mp4,video/webm,video/quicktime';

/** Picks a tool from a toolbar button: the active tool again goes back to Select. */
function pickFromButton(next: ToolPick): void {
  const state = useTool.getState();
  const shown = state.handOverride ? 'hand' : state.tool;
  if (next.tool !== 'select' && next.tool === state.tool && next.tool === shown && (next.tool !== 'shape' || next.kind === state.shapeKind)) {
    state.pick({ tool: 'select' });
    return;
  }
  state.pick(next);
}

/** The foot of the board: the tray (when a tool has one) above the tool bar. */
export function BoardFoot() {
  const tool = useTool((state) => state.tool);
  const touch = useNarrowTouch();
  const canEdit = maybeSession()?.canEdit ?? false;
  const trayDraw = canEdit && DRAW_TOOLS.includes(tool);
  const trayShapes = canEdit && shapesButtonTools(touch).includes(tool);
  return (
    <div className="wb-foot" data-wb-chrome="" data-wb-region="toolbar">
      <TipGroup>
        {trayDraw ? <DrawTray /> : null}
        {trayShapes ? <ShapesTray touch={touch} /> : null}
        <BoardToolbar touch={touch} />
      </TipGroup>
    </div>
  );
}

/** The tool bar. */
function BoardToolbar({ touch }: { touch: boolean }) {
  const tool = useTool((state) => state.tool);
  const handOverride = useTool((state) => state.handOverride);
  const commentMode = useTool((state) => state.commentMode);
  const drawPick = useTool((state) => state.drawPick);
  const shapesPick = useTool((state) => state.shapesPick);
  const keysOn = usePreferences((state) => state.letterKeys);
  const agent = useAgent();
  const session = maybeSession();
  const canEdit = session?.canEdit ?? false;
  const standaloneComment = !session?.shell && session?.comments && session.canComment;
  const shown: ToolName = handOverride ? 'hand' : tool;
  const fileInput = useRef<HTMLInputElement>(null);

  // On touch, the section lives under Shapes; elsewhere the Shapes button never shows it.
  const shapesButtonPick: ToolPick = !touch && shapesPick.tool === 'container' ? { tool: 'shape', kind: 'rounded' } : shapesPick;
  const showAsk = (session?.canAsk ?? false) && agent.available;

  return (
    <Card role="toolbar" aria-label="Board tools" className="wb-fbar">
      <ToolButton
        label="Select"
        icon={<TOOL_ICONS.select aria-hidden="true" />}
        shortcut={toolShortcutKey('select', keysOn) ?? 'Esc'}
        pressed={shown === 'select' && !commentMode}
        onClick={() => pickFromButton({ tool: 'select' })}
      />
      <ToolButton label="Hand" icon={<TOOL_ICONS.hand aria-hidden="true" />} shortcut={toolShortcutKey('hand', keysOn)} pressed={shown === 'hand'} onClick={() => pickFromButton({ tool: 'hand' })} />
      {canEdit ? (
        <>
          <input
            ref={fileInput}
            type="file"
            accept={PICTURE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              if (files.length > 0) void insertFiles(files);
            }}
          />
          <ChromeDivider />
          <ToolButton label="Text" icon={<TOOL_ICONS.text aria-hidden="true" />} shortcut={toolShortcutKey('text', keysOn)} pressed={shown === 'text'} onClick={() => pickFromButton({ tool: 'text' })} />
          {touch ? null : (
            <ToolButton
              label="Section"
              icon={<TOOL_ICONS.container aria-hidden="true" />}
              shortcut={toolShortcutKey('container', keysOn)}
              pressed={shown === 'container'}
              onClick={() => pickFromButton({ tool: 'container' })}
            />
          )}
          <ToolButton
            label="Note"
            tip="Sticky note"
            icon={<TOOL_ICONS.note aria-hidden="true" />}
            shortcut={toolShortcutKey('note', keysOn)}
            pressed={shown === 'note'}
            onClick={() => pickFromButton({ tool: 'note' })}
          />
          <ToolButton
            label="Draw"
            tip={`Draw: ${toolPickLabel({ tool: drawPick })}`}
            icon={<ToolPickIcon pick={{ tool: drawPick }} />}
            shortcut={toolShortcutKey(drawPick, keysOn)}
            pressed={DRAW_TOOLS.includes(shown)}
            onClick={() => pickFromButton({ tool: drawPick })}
          />
          <ToolButton
            label="Shapes"
            tip={`Shapes: ${toolPickLabel(shapesButtonPick)}`}
            icon={<ToolPickIcon pick={shapesButtonPick} />}
            shortcut={toolShortcutKey(shapesButtonPick.tool, keysOn, shapesButtonPick.kind)}
            pressed={shapesButtonTools(touch).includes(shown)}
            onClick={() => pickFromButton(shapesButtonPick)}
          />
          <StickerButton keysOn={keysOn} onUpload={() => fileInput.current?.click()} />
        </>
      ) : null}
      {standaloneComment ? (
        <ToolButton
          label="Comment"
          tip={commentMode ? 'Comment mode is on: click the board to comment' : 'Comment'}
          icon={<MessageCircle aria-hidden="true" />}
          shortcut={keysOn ? 'C' : undefined}
          pressed={commentMode}
          onClick={() => useTool.getState().setCommentMode(!commentMode)}
        />
      ) : null}
      {showAsk ? (
        <>
          <ChromeDivider />
          <AskButton name={agent.name} busy={agent.busy} />
        </>
      ) : null}
    </Card>
  );
}

/** "Ask <agent>": a text pill that opens the Ask panel about the board. */
function AskButton({ name, busy }: { name: string; busy: boolean }) {
  const open = useAsk((state) => state.open);
  return (
    <Tip label={busy ? `${name} is working on the board` : `Ask ${name} about the board`} shortcut={`${modKey()}K`} side="top">
      <ChromeButton size="xl" pressed={open} className="gap-1.5 bg-chrome-hover px-3 hover:bg-chrome-line" onClick={() => useAsk.getState().toggle()}>
        {busy ? <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" /> : null}
        Ask {name}
      </ChromeButton>
    </Tip>
  );
}

/** The Stickers button and its picker. */
function StickerButton({ keysOn, onUpload }: { keysOn: boolean; onUpload: () => void }) {
  const tool = useTool((state) => state.tool);
  const sticker = useTool((state) => state.sticker);
  const [open, setOpen] = useState(false);
  const session = maybeSession();
  const on = tool === 'sticker';
  const awaiting = on && sticker === undefined;
  const me = session ? { id: session.viewer.id, name: session.viewer.name } : undefined;

  // The tool went down elsewhere (Escape, another tool): close the picker.
  useEffect(() => {
    if (!on) setOpen(false);
  }, [on]);

  const putDown = () => useTool.getState().pick({ tool: 'select' });
  const choose = (choice: StickerChoice) => {
    useTool.getState().armSticker(choice);
    setOpen(false);
  };

  return (
    <ChromePopover
      open={open || awaiting}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          if (!on) useTool.getState().armSticker(undefined);
        } else {
          setOpen(false);
          if (useTool.getState().tool === 'sticker' && useTool.getState().sticker === undefined) putDown();
        }
      }}
      side="top"
      gap={12}
      label="Stickers"
      className="p-1.5"
      anchor={() => document.querySelector('.wb-fbar')}
      trigger={
        <ToolButton
          label="Stickers"
          tip={on && !awaiting ? 'The Sticker tool is on: click the board to place one' : 'Add a picture or a sticker'}
          icon={<TOOL_ICONS.sticker aria-hidden="true" />}
          shortcut={toolShortcutKey('sticker', keysOn)}
          pressed={on}
          onClick={(event) => {
            // A second click on an armed tool puts it down instead of reopening the picker.
            if (on && !awaiting && !open) {
              event.preventDefault();
              putDown();
            }
          }}
        />
      }
    >
      <StickerPicker
        onPick={choose}
        onUpload={
          session?.assets
            ? () => {
                setOpen(false);
                putDown();
                onUpload();
              }
            : undefined
        }
        me={me}
      />
    </ChromePopover>
  );
}

/** A tray above the bar. */
function Tray({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card role="toolbar" aria-label={label} className="wb-tray">
      {children}
    </Card>
  );
}

/** Pen, Arrow and the ink colors (built-in, plus colors people added for everyone). */
function DrawTray() {
  const tool = useTool((state) => state.tool);
  const ink = useTool((state) => state.ink);
  const keysOn = usePreferences((state) => state.letterKeys);
  const scheme = useColorScheme();
  const added = useBoard((state) => state.board.content.inks);
  const custom = useRef<HTMLInputElement>(null);

  const swatches = useMemo<Swatch[]>(() => {
    const extra = (added ?? []).map((entry) => entry.color);
    return [
      ...INK_COLOR_NAMES.map((name) => ({ name, value: themedInkColor(name, scheme), label: capitalizeFirstLetter(name) })),
      ...extra.map((color) => ({ name: color, value: themedInkColor(color, scheme), label: color.toUpperCase() })),
    ];
  }, [added, scheme]);
  const removable = ink.startsWith('#') && (added ?? []).some((entry) => entry.color === ink) ? ink : undefined;

  return (
    <Tray label="Draw">
      {(['pen', 'arrow'] as const).map((name) => (
        <ToolButton
          key={name}
          size="lg"
          label={toolPickLabel({ tool: name })}
          icon={<ToolPickIcon pick={{ tool: name }} />}
          shortcut={toolShortcutKey(name, keysOn)}
          pressed={tool === name}
          onClick={() => useTool.getState().pick({ tool: name })}
        />
      ))}
      <ChromeDivider />
      <SwatchRow label="Ink color" swatches={swatches} current={ink} onPick={(name) => useTool.getState().setInk(name as typeof ink)} size={18} className="max-w-[min(420px,calc(100vw-160px))] overflow-x-auto" />
      <ToolButton
        size="lg"
        label="Add a color for everyone"
        icon={<span aria-hidden="true" className="block size-[18px] rounded-full bg-[conic-gradient(#e5484d,#f76b15,#e2a336,#30a46c,#0090ff,#8e4ec6,#e5484d)] ring-1 ring-inset ring-black/10" />}
        onClick={() => custom.current?.click()}
      />
      <input
        ref={custom}
        type="color"
        hidden
        onChange={(event) => {
          const color = event.target.value.toLowerCase() as HexColor;
          addBoardInk(color);
          useTool.getState().setInk(color);
        }}
      />
      {removable ? (
        <ToolButton
          size="lg"
          label={`Remove color ${removable.toUpperCase()} for everyone`}
          icon={<span aria-hidden="true" className="text-[18px] leading-none">×</span>}
          onClick={() => {
            removeBoardInk(removable);
            useTool.getState().setInk('ink');
          }}
        />
      ) : null}
    </Tray>
  );
}

/** Every shape kind, then the table (and the section on touch). */
function ShapesTray({ touch }: { touch: boolean }) {
  const tool = useTool((state) => state.tool);
  const kind = useTool((state) => state.shapeKind);
  const keysOn = usePreferences((state) => state.letterKeys);
  const kinds = [...BASIC_SHAPE_KINDS, ...MORE_SHAPE_KINDS];
  return (
    <Tray label="Shapes">
      <div className="grid grid-cols-7 gap-0.5 max-[420px]:grid-cols-5">
        {kinds.map((shape) => (
          <ToolButton
            key={shape}
            size="lg"
            label={SHAPE_KIND_LABELS[shape]}
            icon={<ShapeKindIcon kind={shape} />}
            shortcut={toolShortcutKey('shape', keysOn, shape)}
            pressed={tool === 'shape' && kind === shape}
            onClick={() => useTool.getState().pick(toolPickForShapeKind(shape))}
          />
        ))}
        {touch ? (
          <ToolButton size="lg" label="Section" icon={<TOOL_ICONS.container aria-hidden="true" />} pressed={tool === 'container'} onClick={() => useTool.getState().pick({ tool: 'container' })} />
        ) : null}
        <ToolButton size="lg" label="Table" icon={<TOOL_ICONS.table aria-hidden="true" />} shortcut={toolShortcutKey('table', keysOn)} pressed={tool === 'table'} onClick={() => useTool.getState().pick({ tool: 'table' })} />
      </div>
    </Tray>
  );
}
