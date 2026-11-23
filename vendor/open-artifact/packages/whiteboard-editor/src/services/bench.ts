/**
 * The benchmark hook (`e2e/bench/whiteboard.mjs`): with `?open_artifact_bench=1` the
 * page exposes `window.__openArtifactWhiteboard`, which shows a generated board
 * bigger than a stored board may be (in this page only: nothing is saved
 * unless someone edits it) and reports what the page draws.
 */

import { measuredArrowGeometry, normalizeElement, type BoardElement, type ElementId } from '@open-artifact/whiteboard-core';
import { useBoard, setBoardSnapshot } from '../state/board.ts';
import type { Camera } from '../lib/camera.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures } from '../state/measures.ts';
import { useSelection } from '../state/selection.ts';

/** What `window.__openArtifactWhiteboard` offers. */
export interface WhiteboardBench {
  /** Shows these elements (stored element shapes with ids) as the board. Returns how many were kept. */
  show(elements: readonly unknown[]): number;
  /** What the page draws now. */
  state(): Record<string, unknown>;
  /** Elements by id, as shown. */
  elements(ids: readonly ElementId[]): Array<BoardElement | null>;
  /** Moves the camera. */
  setCamera(camera: Camera): void;
  /** Where an arrow is drawn now, or `null`. */
  arrowLine(id: ElementId): { x1: number; y1: number; x2: number; y2: number } | null;
}

declare global {
  interface Window {
    __openArtifactWhiteboard?: WhiteboardBench;
  }
}

/** Installs the hook when the page asks for it (`?open_artifact_bench=1`); returns a function that removes it. */
export function installBenchHook(search: string = location.search): () => void {
  if (new URLSearchParams(search).get('open_artifact_bench') !== '1') return () => {};
  window.__openArtifactWhiteboard = {
    show(raw) {
      const taken = new Set<ElementId>();
      const elements: BoardElement[] = [];
      for (const each of raw) {
        const element = normalizeElement(each, taken);
        if (!element) continue;
        taken.add(element.id);
        elements.push(element);
      }
      const { board } = useBoard.getState();
      setBoardSnapshot({ ...board, content: { ...board.content, elements } });
      return elements.length;
    },
    state() {
      return {
        elementViews: document.querySelectorAll('.wb-layer [data-wb-id]').length,
        elements: useBoard.getState().board.content.elements.length,
        camera: useCamera.getState().camera,
        selection: useSelection.getState().ids,
      };
    },
    elements(ids) {
      const { byId } = useBoard.getState();
      return ids.map((id) => byId.get(id) ?? null);
    },
    setCamera(camera) {
      useCamera.getState().setCamera(camera);
    },
    arrowLine(id) {
      const { byId } = useBoard.getState();
      const arrow = byId.get(id);
      const line = arrow?.type === 'arrow' ? measuredArrowGeometry(arrow, byId, currentMeasures()) : undefined;
      return line ? { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 } : null;
    },
  };
  return () => {
    delete window.__openArtifactWhiteboard;
  };
}
