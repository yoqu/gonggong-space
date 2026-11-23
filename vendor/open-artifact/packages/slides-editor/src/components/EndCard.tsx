/**
 * The card at the stage's top-right corner: Present, then the
 * properties-panel toggle, the zoom readout with its menu (which also holds
 * undo and redo) and the sync dot.
 */

import { type ReactNode } from 'react';
import { BookText, ChevronDown, History, Play, SlidersHorizontal } from 'lucide-react';
import { ZOOM_PRESETS } from '@open-artifact/canvas-engine/camera';
import { cn } from '@open-artifact/ui';
import { present, zoomStep } from '../keyboard.ts';
import { useDeck } from '../state/deck.ts';
import { stageScale, useView } from '../state/view.ts';
import { redo, undo } from '../services/commands.ts';
import { slideHistory } from '../services/history.ts';
import { retryNow } from '../services/sync.ts';
import { Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ChromeMenuLabel, ChromeMenuSeparator, MOD, SHIFT, Tip, useShellDraw } from '@open-artifact/editor-kit/react';
import { session } from '../services/session.ts';

const ICON = { className: 'size-5', strokeWidth: 1.5 } as const;
const SMALL = { className: 'size-4', strokeWidth: 1.5 } as const;

/** ▷ Present: from this slide, from the start, or with the speaker window. */
function PresentMenu(): ReactNode {
  const hasSlides = useDeck((s) => s.index.order.length > 0);
  const hasNotes = useDeck((s) => Object.values(s.slides).some((entry) => Boolean(entry.slide.notes.trim())));
  return (
    <ChromeMenu
      align="end"
      tip={{ label: 'Present', shortcut: `${MOD}↵` }}
      trigger={
        <ChromeButton size="lg" square aria-label="Present" disabled={!hasSlides}>
          <Play {...ICON} />
        </ChromeButton>
      }
    >
      <ChromeMenuItem icon={<Play {...SMALL} />} shortcut={`${MOD}↵`} onSelect={() => present('current')}>
        Present
      </ChromeMenuItem>
      <ChromeMenuItem shortcut={`${SHIFT}${MOD}↵`} onSelect={() => present('start')}>
        From the start
      </ChromeMenuItem>
      <ChromeMenuItem
        icon={<BookText {...SMALL} />}
        disabled={!hasNotes}
        title={hasNotes ? undefined : 'No slide has speaker notes. Add some under View › Speaker notes.'}
        onSelect={() => present('current', true)}
      >
        Present with speaker notes
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

/** "32% ⌄": the zoom readout and its menu (with undo and redo). */
function ZoomMenu(): ReactNode {
  const zoom = useView((s) => s.zoom);
  const fitScale = useView((s) => s.fitScale);
  const setZoom = useView((s) => s.setZoom);
  const canUndo = useDeck((s) => s.undo.length > 0 && !s.readOnly);
  const canRedo = useDeck((s) => s.redo.length > 0 && !s.readOnly);
  const scale = stageScale({ zoom, fitScale });
  const percent = Math.round(scale * 100);
  const preset = ZOOM_PRESETS.find((z) => zoom === z);
  return (
    <ChromeMenu
      align="end"
      tip={{ label: 'Zoom', shortcut: `${MOD}+ / ${MOD}− / ${MOD}0` }}
      trigger={
        <ChromeButton aria-label="Zoom" size="lg" className="min-w-[68px] justify-between gap-0.5 pl-2 pr-1 tabular-nums">
          {percent}%
          <ChevronDown className="size-4 text-chrome-muted" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      <ChromeMenuItem shortcut={`${MOD}+`} closeOnClick={false} onSelect={() => zoomStep(1)}>
        Zoom in
      </ChromeMenuItem>
      <ChromeMenuItem shortcut={`${MOD}−`} closeOnClick={false} onSelect={() => zoomStep(-1)}>
        Zoom out
      </ChromeMenuItem>
      <ChromeMenuItem checked={zoom === 'fit'} shortcut={`${MOD}0`} onSelect={() => setZoom('fit')}>
        Fit the slide
      </ChromeMenuItem>
      <ChromeMenuSeparator />
      {zoom !== 'fit' && preset === undefined ? <ChromeMenuLabel>Now {percent}%</ChromeMenuLabel> : null}
      {ZOOM_PRESETS.map((z) => (
        <ChromeMenuItem key={z} checked={zoom === z} onSelect={() => setZoom(z)}>
          {z * 100}%
        </ChromeMenuItem>
      ))}
      <ChromeMenuSeparator />
      <ChromeMenuItem shortcut={`${MOD}Z`} disabled={!canUndo} closeOnClick={false} onSelect={undo}>
        Undo
      </ChromeMenuItem>
      <ChromeMenuItem shortcut={`${SHIFT}${MOD}Z`} disabled={!canRedo} closeOnClick={false} onSelect={redo}>
        Redo
      </ChromeMenuItem>
    </ChromeMenu>
  );
}

/** The sync dot: saving, couldn't save (click to retry), or all saved. */
function SyncDot(): ReactNode {
  const save = useDeck((s) => s.save);
  if (save === 'readonly') return null;
  const offline = save === 'offline';
  const busy = save === 'saving' || save === 'dirty';
  const label = offline ? 'Couldn’t sync — click to retry' : busy ? 'Syncing…' : 'All changes synced';
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={!offline}
        onClick={retryNow}
        className="flex h-8 w-[22px] shrink-0 items-center justify-center rounded-[6px] outline-none enabled:hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent"
      >
        <span
          className={cn(
            'size-1.5 rounded-full transition-colors',
            offline ? 'bg-danger' : busy ? 'animate-pulse bg-chrome-muted' : 'bg-success',
          )}
        />
      </button>
    </Tip>
  );
}

/** Props of {@link EndCard}. */
export interface EndCardProps {
  /** A slide is on stage: the properties toggle is live and the zoom shows. */
  onStage: boolean;
}

/** The card. */
export function EndCard({ onStage }: EndCardProps): ReactNode {
  const showProperties = useView((s) => s.showProperties);
  const readOnly = useDeck((s) => s.readOnly);
  const historyAvailable = slideHistory.store(s => s.available);
  const label = showProperties ? 'Hide the properties panel' : 'Show the properties panel';
  // In a Shell its Share panel's Export tab lists the formats and its bar shows the save state.
  const shellSaved = useShellDraw(session().shell, 'saved');
  return (
    <Card className="h-10 gap-1 px-1 py-px">
      {!session().shell && historyAvailable ? <Tip label="Version history">
        <ChromeButton size="lg" square aria-label="Version history" onClick={() => slideHistory.toggle(true)}><History {...ICON} /></ChromeButton>
      </Tip> : null}
      <PresentMenu />
      {!readOnly ? (
        <>
          <ChromeDivider />
          <Tip label={onStage ? label : 'Open a slide to edit its properties'} shortcut={onStage ? `${MOD}\\` : undefined}>
            <ChromeButton size="lg" square pressed={showProperties && onStage} disabled={!onStage} aria-label="Properties" onClick={() => useView.getState().toggle('showProperties')}>
              <SlidersHorizontal {...ICON} />
            </ChromeButton>
          </Tip>
        </>
      ) : null}
      {onStage ? (
        <>
          <ChromeDivider />
          <ZoomMenu />
        </>
      ) : null}
      {shellSaved ? null : <SyncDot />}
    </Card>
  );
}
