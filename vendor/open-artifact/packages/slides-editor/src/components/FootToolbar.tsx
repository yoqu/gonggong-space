/**
 * The toolbar floating at the bottom of the stage: the Text tool, Image or
 * video, Table, the Shapes tool and its menu, and the Ask field
 * that hands a request to the agent with what this viewer is looking at.
 */

import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, Circle, Diamond, Film, Image, Loader2, Minus, MoveRight, RectangleHorizontal, Shapes, Spline, Square, Table, Type } from 'lucide-react';
import { cn, isComposingKey } from '@open-artifact/ui';
import { getToolbarKeyTarget, isTextField } from '@open-artifact/editor-kit';
import { useUi } from '../state/ui.ts';
import { useView, type Tool } from '../state/view.ts';
import { sendToAgent, useAgent } from '../services/agent.ts';
import { MEDIA_ACCEPT, pickFiles, placeFiles } from '../services/assets.ts';
import { insertShape, type InsertShapeKind } from '../services/commands.ts';
import { Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ChromeMenuSeparator, SHIFT, Tip } from '@open-artifact/editor-kit/react';

const ICON = { className: 'size-5', strokeWidth: 1.5 } as const;
const SMALL = { className: 'size-4', strokeWidth: 1.5 } as const;

/** Shape tools of the Shapes menu: [tool, label, icon, shortcut]. */
const SHAPES: [Tool, string, ReactNode, string][] = [
  ['rect', 'Rectangle', <Square key="r" {...SMALL} />, 'R'],
  ['rounded', 'Rounded rectangle', <RectangleHorizontal key="rr" {...SMALL} />, `${SHIFT}R`],
  ['ellipse', 'Ellipse', <Circle key="e" {...SMALL} />, 'O'],
  ['diamond', 'Diamond (decision)', <Diamond key="d" {...SMALL} />, 'D'],
];

/** Line tools, drawn from point to point. */
const LINES: [Tool, string, ReactNode, string][] = [
  ['line', 'Line', <Minus key="l" {...SMALL} />, 'L'],
  ['connector', 'Connector', <Spline key="c" {...SMALL} />, `${SHIFT}L`],
];

/** Every drawing tool. */
const DRAW = [...SHAPES, ...LINES];

/** Arrows placed at once (no drawing tool): [kind, label, icon]. */
const ARROWS: [InsertShapeKind, string, ReactNode][] = [
  ['arrow-right', 'Arrow right', <MoveRight key="ar" {...SMALL} />],
  ['arrow-left', 'Arrow left', <MoveRight key="al" {...SMALL} className="size-4 rotate-180" />],
  ['arrow-up', 'Arrow up', <MoveRight key="au" {...SMALL} className="size-4 -rotate-90" />],
  ['arrow-down', 'Arrow down', <MoveRight key="ad" {...SMALL} className="size-4 rotate-90" />],
];

/** Picks pictures or clips and places them on the slide. */
function pickMedia(): void {
  void pickFiles(MEDIA_ACCEPT, true).then((files) => {
    if (files.length) void placeFiles(files);
  });
}

/** The Shapes button: the last drawing tool, and a menu of every shape. */
function ShapesMenu(): ReactNode {
  const tool = useView((s) => s.tool);
  const drawing = DRAW.find(([t]) => t === tool);
  return (
    <ChromeMenu
      side="top"
      align="center"
      tip={{ label: drawing ? drawing[1] : 'Shapes', side: 'top' }}
      trigger={
        <ChromeButton size="lg" pressed={Boolean(drawing)} aria-label="Shapes" className="gap-0 pl-1.5 pr-0.5">
          {drawing ? <span className="flex size-5 items-center justify-center [&>svg]:size-5">{drawing[2]}</span> : <Shapes {...ICON} />}
          <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      {SHAPES.map(([t, label, icon, shortcut]) => (
        <ChromeMenuItem key={t} icon={icon} shortcut={shortcut} onSelect={() => useView.getState().setTool(t)}>
          {label}
        </ChromeMenuItem>
      ))}
      {ARROWS.map(([kind, label, icon]) => (
        <ChromeMenuItem key={kind} icon={icon} onSelect={() => insertShape(kind)}>
          {label}
        </ChromeMenuItem>
      ))}
      <ChromeMenuSeparator />
      {LINES.map(([t, label, icon, shortcut]) => (
        <ChromeMenuItem key={t} icon={icon} shortcut={shortcut} onSelect={() => useView.getState().setTool(t)}>
          {label}
        </ChromeMenuItem>
      ))}
    </ChromeMenu>
  );
}

/** The Image button: pictures and clips from this computer, or a video link. */
function MediaMenu(): ReactNode {
  return (
    <ChromeMenu
      side="top"
      align="center"
      tip={{ label: 'Image or video', side: 'top' }}
      trigger={
        <ChromeButton size="lg" square aria-label="Image or video">
          <Image {...ICON} />
        </ChromeButton>
      }
    >
      <ChromeMenuItem icon={<Image {...SMALL} />} onSelect={pickMedia}>
        Image or video from this computer…
      </ChromeMenuItem>
      <ChromeMenuItem icon={<Film {...SMALL} />} onSelect={() => useUi.getState().open('videoLink')}>
        Video link…
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

/** The Ask field: one line that grows into the composer while focused. */
function AskField(): ReactNode {
  const name = useAgent((s) => s.status.name);
  const busy = useAgent((s) => s.status.busy);
  const selected = useView((s) => s.selection.length);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);

  const send = async (): Promise<void> => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      if (await sendToAgent(message)) setText('');
    } finally {
      setSending(false);
    }
  };

  const open = focused || text.length > 0;
  return (
    <form
      className={cn('flex h-8 shrink-0 items-center gap-1 rounded-[8px] bg-chrome-field pl-2.5 pr-1 transition-[width] duration-150', open ? 'w-64' : 'w-[100px]')}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-chrome-muted" aria-label={`${name} is working`} /> : null}
      <input
        value={text}
        aria-label={`Ask ${name}`}
        maxLength={4000}
        placeholder={open ? (selected ? `Ask ${name} about the selection…` : `Ask ${name} to change this slide…`) : `Ask ${name}`}
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-chrome-fg outline-none placeholder:text-chrome-muted"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      {open ? (
        <button
          type="submit"
          aria-label="Send"
          disabled={!text.trim() || sending}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chrome-fg text-chrome outline-none disabled:opacity-30"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" strokeWidth={2} />}
        </button>
      ) : null}
    </form>
  );
}

/** Props of {@link FootToolbar}. */
export interface FootToolbarProps {
  /** Show the tools that change the slide (an editor who can change it). */
  editing: boolean;
  /** Show the Ask field. */
  ask: boolean;
}

/** The toolbar (the caller places it). */
export function FootToolbar({ editing, ask }: FootToolbarProps): ReactNode {
  const tool = useView((s) => s.tool);
  const view = useView.getState;
  if (!editing && !ask) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isComposingKey(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextField(event.target)) return;
    if (document.querySelector('[role="menu"], [role="listbox"]')) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].filter(
      (button) => !button.closest('form'),
    );
    const active = document.activeElement;
    const index = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;
    const next = getToolbarKeyTarget(event.key, index, buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <Card role="toolbar" aria-label={editing ? 'Insert' : 'Ask'} className="max-w-full gap-1 p-1" onKeyDown={onKeyDown}>
      {editing ? (
        <>
          <Tip label="Text" shortcut="T" side="top">
            <ChromeButton size="lg" square pressed={tool === 'text'} aria-label="Text" onClick={() => view().setTool(tool === 'text' ? 'select' : 'text')}>
              <Type {...ICON} />
            </ChromeButton>
          </Tip>
          <MediaMenu />
          <Tip label="Table" side="top">
            <ChromeButton size="lg" square aria-label="Table" onClick={() => useUi.getState().open('table')}>
              <Table {...ICON} />
            </ChromeButton>
          </Tip>
          <ShapesMenu />
        </>
      ) : null}
      {ask ? (
        <>
          {editing ? <ChromeDivider className="mx-0" /> : null}
          <AskField />
        </>
      ) : null}
    </Card>
  );
}
