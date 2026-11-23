/**
 * Version history on the board: the panel (`HistoryPanel` from the UI
 * package) on the right, and a read-only preview of a past version over the
 * board.
 *
 * The preview paints the version the way a board picture is painted (its
 * own elements, title and pictures, in the current color scheme) and fits
 * it to the window. Clicking an element picks it; the banner restores the
 * picked elements (one undoable change of this board), the whole version
 * (through the host), or goes back to the current board.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { Button, ConfirmDialog, HistoryPanel, cn } from '@open-artifact/ui';
import { elementBounds, formatBoardHistoryPath, type Board } from '@open-artifact/whiteboard-core';
import { drawnImagePen } from '../export/drawn-svg.ts';
import { exportFrameFor, type ExportFrame } from '../export/frame.ts';
import { loadPictureAssets } from '../export/images.ts';
import { canvasToPngBlob, drawBoardCanvas } from '../export/paint.ts';
import { faceNameResolver } from '../services/export.ts';
import { maybeSession } from '../services/session.ts';
import { useShellDraws } from '../services/shell.ts';
import {
  historyCapability,
  previewVersion,
  restorePickedElements,
  restoreVersion,
  togglePicked,
  toggleVersionHistory,
  useVersionHistory,
} from '../services/version-history.ts';
import { currentMeasures } from '../state/measures.ts';
import { useTheme } from '../state/theme.ts';

/** Longest edge of a preview picture, pixels. */
const PREVIEW_MAX_PX = 2400;
/** How long a preview waits for its pictures, ms. */
const PREVIEW_IMAGE_TIMEOUT_MS = 8000;
/** Room around the fitted picture, pixels. */
const FIT_MARGIN = 24;

/** The history panel, on the right. */
function VersionHistoryPanel(): ReactNode {
  const open = useVersionHistory((s) => s.open);
  const previewing = useVersionHistory((s) => s.previewing);
  const history = historyCapability();
  if (!open || !history) return null;
  return (
    <aside className="wb-history-panel" aria-label="Version history">
      <HistoryPanel
        className="min-h-0 flex-1"
        history={history}
        viewerId={maybeSession()?.viewer.id}
        previewing={previewing}
        onPreview={(n) => void previewVersion(n)}
        onClose={() => toggleVersionHistory(false)}
        formatPath={formatBoardHistoryPath}
      />
    </aside>
  );
}

/** A painted version: the picture's URL and its frame. */
interface Painted {
  url: string;
  frame: ExportFrame;
}

/** Paints a version's board into a picture URL (revoked by the caller). */
async function paintVersion(board: Board, scheme: 'light' | 'dark'): Promise<Painted | null> {
  const elements = board.content.elements;
  const measures = currentMeasures();
  const frame = exportFrameFor(elements, measures, PREVIEW_MAX_PX);
  if (!frame) return null;
  const assets = await loadPictureAssets(elements, drawnImagePen(scheme), PREVIEW_IMAGE_TIMEOUT_MS);
  try {
    const canvas = drawBoardCanvas({
      elements,
      title: board.title,
      measures,
      frame,
      scheme,
      images: assets.images,
      imageSources: assets.imageSources,
      icons: assets.icons,
      showAuthors: true,
      faceName: faceNameResolver(),
    });
    try {
      return { url: URL.createObjectURL(await canvasToPngBlob(canvas)), frame };
    } finally {
      canvas.width = 0;
    }
  } finally {
    assets.release();
  }
}

/** The read-only preview of a past version, over the board. */
function VersionPreview(): ReactNode {
  const previewing = useVersionHistory((s) => s.previewing);
  const preview = useVersionHistory((s) => s.preview);
  const loading = useVersionHistory((s) => s.loading);
  const error = useVersionHistory((s) => s.error);
  const canRestore = useVersionHistory((s) => s.canRestore);
  const picked = useVersionHistory((s) => s.picked);
  const scheme = useTheme((s) => s.scheme);
  const [painted, setPainted] = useState<Painted | null>(null);
  const [painting, setPainting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!preview) {
      setPainted(null);
      return;
    }
    let live = true;
    let made: Painted | null = null;
    setPainting(true);
    paintVersion(preview.board, scheme)
      .then((result) => {
        made = result;
        if (live) setPainted(result);
        else if (result) URL.revokeObjectURL(result.url);
      })
      .catch(() => {
        if (live) setPainted(null);
      })
      .finally(() => {
        if (live) setPainting(false);
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made.url);
    };
  }, [preview, scheme]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ w: element.clientWidth, h: element.clientHeight }));
    observer.observe(element);
    setSize({ w: element.clientWidth, h: element.clientHeight });
    return () => observer.disconnect();
  }, [previewing]);

  const boxes = useMemo(() => {
    if (!preview || !painted) return [];
    const measures = currentMeasures();
    const { frame } = painted;
    return preview.board.content.elements.flatMap((element) => {
      const box = elementBounds(element, measures);
      if (!box) return [];
      return [
        {
          id: element.id,
          left: ((box.x - frame.board.x) * frame.scale) / frame.width,
          top: (frame.titleBar + (box.y - frame.board.y) * frame.scale) / frame.height,
          width: (box.w * frame.scale) / frame.width,
          height: (box.h * frame.scale) / frame.height,
        },
      ];
    });
  }, [preview, painted]);

  if (previewing === null) return null;
  const n = previewing;
  const fit = painted ? Math.min(1, (size.w - FIT_MARGIN * 2) / painted.frame.width, (size.h - FIT_MARGIN * 2) / painted.frame.height) : 0;
  const empty = preview !== null && preview.board.content.elements.length === 0;
  const editable = canRestore && (maybeSession()?.canEdit ?? false);
  const pickedSet = new Set(picked);
  return (
    <div className="wb-history-preview" role="region" aria-label={`Version ${n}, read-only`}>
      <div className="wb-history-banner">
        <History className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px]">
          Previewing version {n}
          {editable && !empty ? <span className="text-chrome-muted"> · click elements to pick them</span> : null}
        </span>
        {editable && picked.length > 0 ? (
          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => restorePickedElements()}>
            Restore {picked.length === 1 ? 'element' : `${picked.length} elements`}
          </Button>
        ) : null}
        {editable ? (
          <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirm(true)}>
            Restore this version
          </Button>
        ) : null}
        <Button size="sm" icon={<X className="size-3.5" />} onClick={() => void previewVersion(null)}>
          Back to current
        </Button>
      </div>
      <div ref={stage} className="wb-history-stage">
        {loading || painting ? (
          <Loader2 className="size-5 animate-spin text-chrome-muted" aria-label="Loading the version" />
        ) : error ? (
          <p className="text-[13px] text-chrome-muted">This version could not be read: {error}</p>
        ) : empty ? (
          <p className="text-[13px] text-chrome-muted">The board was empty in this version.</p>
        ) : painted && fit > 0 ? (
          <div className="relative shadow-chrome" style={{ width: painted.frame.width * fit, height: painted.frame.height * fit }}>
            <img src={painted.url} alt={`The board as version ${n} left it`} className="block size-full select-none" draggable={false} />
            {editable
              ? boxes.map((box) => (
                  <button
                    key={box.id}
                    type="button"
                    aria-pressed={pickedSet.has(box.id)}
                    aria-label={`Pick element ${box.id}`}
                    className={cn('wb-history-pick', pickedSet.has(box.id) && 'wb-history-picked')}
                    style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
                    onClick={() => togglePicked(box.id)}
                  />
                ))
              : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Restore version ${n}?`}
        description="The whole board goes back to how this version left it. Everyone on the board sees the change, and the current board stays in the history."
        confirmLabel="Restore"
        onConfirm={() => {
          setConfirm(false);
          void restoreVersion(n);
        }}
      />
    </div>
  );
}

/** The history entry point outside a Shell, for the zoom menu. */
export function useVersionHistoryEntry(): { shown: boolean; open: boolean } {
  const available = useVersionHistory((s) => s.available);
  const open = useVersionHistory((s) => s.open);
  const framed = useShellDraws((s) => s.framed);
  return { shown: available && !framed, open };
}

/** Version history: the panel and the preview. */
export function VersionHistory(): ReactNode {
  return (
    <>
      <VersionPreview />
      <VersionHistoryPanel />
    </>
  );
}
