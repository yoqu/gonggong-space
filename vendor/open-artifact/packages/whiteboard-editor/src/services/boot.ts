/**
 * Boot: connects the session, follows the color scheme, restores this tab's
 * camera, connects the Shell and the agent, starts live sync, collaboration,
 * exports and version history, and installs the board's input (tools, hover, keys,
 * clipboard, drops, the text editor's host). Returns a function that stops everything.
 */

import { surfaceRef } from '../canvas/BoardSurface.tsx';
import { startCollab } from '../collab/index.ts';
import { followColorScheme } from '../state/theme.ts';
import { installBenchHook } from './bench.ts';
import { installHover } from '../tools/index.ts';
import { watchAgent } from './agent.ts';
import { announce } from './announce.ts';
import { startDrawingLooks } from './drawing-looks.ts';
import { startAutoFit } from './auto-fit.ts';
import { installClipboard } from './clipboard.ts';
import { startCropMemory } from './crop.ts';
import { installDrop } from './drop.ts';
import { startExport } from './export.ts';
import { installKeyboard } from './keyboard.ts';
import { installRegions } from './regions.ts';
import { startSession } from './session.ts';
import { startShell } from './shell.ts';
import { startSync } from './sync.ts';
import { installTextEditHost } from './text-host.ts';
import { startTextMetrics } from './text-metrics.ts';
import { startTextPush } from './text-push.ts';
import { startTurnedAnchors } from './turned-anchor.ts';
import { startVersionHistory } from './version-history.ts';
import { keepCameraRemembered, restoreCamera } from './viewport.ts';

/**
 * Starts the board. Call after the board surface has mounted (its input
 * listeners attach to it). Rejects when the page cannot reach its
 * document store.
 */
export async function startBoard(): Promise<() => void> {
  const stops: Array<() => void> = [];
  const stopAll = (): void => {
    for (const stop of stops.reverse()) stop();
    stops.length = 0;
  };
  stops.push(followColorScheme());
  stops.push(startTextMetrics());
  try {
    await startSession();
  } catch (error) {
    stopAll();
    throw error;
  }
  const cameraKey = location.pathname;
  const ownView = restoreCamera(cameraKey);
  stops.push(keepCameraRemembered(cameraKey));
  stops.push(startShell());
  stops.push(watchAgent());
  stops.push(startSync({ announce }));
  stops.push(startAutoFit({ ownView }));
  stops.push(startCollab());
  stops.push(startExport());
  stops.push(startDrawingLooks());
  stops.push(startVersionHistory());
  stops.push(installKeyboard());
  stops.push(installRegions());
  stops.push(startCropMemory());
  stops.push(installClipboard());
  stops.push(installTextEditHost());
  stops.push(startTextPush());
  stops.push(startTurnedAnchors());
  stops.push(installBenchHook());
  const surface = surfaceRef.current;
  if (surface) {
    stops.push(installHover(surface));
    stops.push(installDrop(surface));
  }
  return stopAll;
}
