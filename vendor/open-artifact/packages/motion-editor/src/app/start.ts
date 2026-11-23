/**
 * Starts the page: the compact inspector look, the host connection and live sync (`host/boot.ts`), then the film engine, the keyboard,
 * comments, full screen, the Comments toolbar button and the view context. Resolves to a function that stops it all.
 */

import { createElement } from 'react';
import { create } from 'zustand';
import { guardFileDrops } from '@open-artifact/editor-kit';
import runtime from 'virtual:motion-stage-runtime';
import { FilmEngine } from '../engine/film-engine.ts';
import { setFilmEngine } from '../engine/engine-context.ts';
import { startRetypedUpkeep } from '../engine/retyped-upkeep.ts';
import { disposeSnapshotPixels } from '../engine/snapshot-pixels.ts';
import { registerUndoShortcuts } from '../engine/undo.ts';
import { assetBytes, assetUrl } from '../host/assets.ts';
import { pageFontsIo } from '../host/fonts.ts';
import { startVideoPage } from '../host/boot.ts';
import { filmSource } from '../host/live-film.ts';
import { installShortcuts } from '../keyboard/install.ts';
import { registerPlaybackShortcuts } from '../keyboard/shortcuts.ts';
import { startComments } from '../comments/comments.ts';
import { FilmCommentsButton } from '../comments/CommentLayer.tsx';
import { registerCommentShortcuts } from '../comments/keys.ts';
import { watchFullscreen } from '../transport/fullscreen.ts';
import { registerToolbarItem, TOOLBAR_ORDER } from '../transport/slots.ts';
import { installTweaks } from '../tweaks/install.ts';
import { installLayers } from '../layers/install.ts';
import { installStyle } from '../style/install.ts';
import { installVoiceover } from '../voiceover/install.ts';
import { installExport } from '../export/install.ts';
import { markInspector } from '../panels/inspector.ts';
import { watchStaleBuild } from './stale-build.ts';
import { startViewContext } from './view-context.ts';

export type AppPhase = 'starting' | 'ready' | 'failed';

export const useAppPhase = create<{ phase: AppPhase; error: string | null }>()(() => ({ phase: 'starting', error: null }));

export async function startVideoApp(): Promise<() => void> {
  const unmarkInspector = markInspector();
  const page = await startVideoPage();
  const engine = new FilmEngine({ runtime, source: filmSource, assets: { bytes: assetBytes, url: assetUrl }, fonts: pageFontsIo });
  setFilmEngine(engine);
  const stops: (() => void)[] = [
    unmarkInspector,
    page.stop,
    () => {
      setFilmEngine(null);
      engine.dispose();
      disposeSnapshotPixels();
    },
    installShortcuts(window),
    guardFileDrops(window),
    watchStaleBuild(window),
    registerPlaybackShortcuts(),
    registerCommentShortcuts(),
    startComments(),
    watchFullscreen(),
    registerToolbarItem({
      id: 'comments',
      side: 'end',
      order: TOOLBAR_ORDER.comments,
      render: () => createElement(FilmCommentsButton),
    }),
    registerUndoShortcuts(),
    installTweaks(),
    installLayers(),
    installStyle(),
    installVoiceover(),
    installExport(),
  ];
  if (page.session !== null) {
    engine.start();
    stops.push(startViewContext(), startRetypedUpkeep());
  }
  useAppPhase.setState({ phase: 'ready' });
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}

/** Starts the page once; a failure shows on the page instead of a blank one. */
export function bootVideoApp(): void {
  startVideoApp().catch((error: unknown) => {
    console.error('video: the page could not start', error);
    useAppPhase.setState({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  });
}
