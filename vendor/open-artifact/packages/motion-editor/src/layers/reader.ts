/**
 * Asks the stage for the layers of the stretch on show while the Tweaks panel is open and the film is paused, keeps
 * the pick through new readings, and asks for the picked line's text styles. A newer question overtakes an older one
 * (`seq`); playing ends a reading under way (`stop`).
 */

import { findLayer, hitTestLayers, isLayerOnAt, type LayerHitTest } from '@open-artifact/motion-stage/layers';
import type { LayerRow, LayersReport, StageToHost } from '@open-artifact/motion-stage/protocol';
import { toast } from '@open-artifact/ui';
import { EMPTY_LAYER_MOTION_CHOICE, playSeconds, serializeRetouchedRecord } from '@open-artifact/motion-core';
import { filmEngine } from '../engine/engine-context.ts';
import { seekTo } from '../engine/actions.ts';
import { useFilm, selectDuration, selectParts, selectSceneReports } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { useWorking } from '../stores/working.ts';
import { tellLapsedHides } from './lapsed-hides.ts';
import { useLayers } from './store.ts';
import { layerStretch, stretchTakesRetouch, type LayerStretch } from './stretch.ts';
import { findLayerAgain, holdersOf } from './tree.ts';

/** The Tweaks panel's id: the layers are read only while it is open. */
export const TWEAKS_PANEL = 'tweaks';
/** How long the playhead must rest before the layers are read again. */
export const READ_DEBOUNCE_MS = 120;
/** A reading that found nothing is tried again once, after this long. */
export const RETRY_MS = 1000;

/** The layers can be read now: Tweaks is open, the film is ready and paused, and not in full screen. */
export function layersActive(): boolean {
  const ui = useUi.getState();
  return ui.panel === TWEAKS_PANEL && !ui.fullscreen && useFilm.getState().stage === 'ready' && !usePlayback.getState().playing;
}

/** The stretch the playhead is in now. */
export function currentStretch(): LayerStretch {
  const film = useFilm.getState();
  return layerStretch(selectParts(film), selectSceneReports(film), usePlayback.getState().time, selectDuration(film));
}

let seq = 0;
let pending: { seq: number; stretch: LayerStretch; t: number } | null = null;
let retried = false;
let readTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** The playhead moved to show a picked layer: read at once, keeping the pick. */
let seekingToPick = false;
/** What the last question was asked for, so the same is not asked twice. */
let asked: { key: string; t: number; revision: number; meta: unknown; record: string | null } | null = null;
let stylesSeq = 0;

function clearTimers(): void {
  if (readTimer !== undefined) clearTimeout(readTimer);
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  readTimer = retryTimer = undefined;
}

function send(stretch: LayerStretch, t: number): void {
  const engine = filmEngine();
  if (engine === null) return;
  seq += 1;
  pending = { seq, stretch, t };
  engine.send({ type: 'layers', seq, from: playSeconds(stretch.from), to: playSeconds(stretch.to), at: playSeconds(t), scene: stretch.scene, stop: false });
}

/** Ends a reading under way. */
function stop(): void {
  clearTimers();
  if (pending === null) return;
  const { stretch, t } = pending;
  pending = null;
  seq += 1;
  filmEngine()?.send({ type: 'layers', seq, from: playSeconds(stretch.from), to: playSeconds(stretch.to), at: playSeconds(t), scene: stretch.scene, stop: true });
}

/** Reads the layers again now (after a failure). */
export function retryLayers(): void {
  asked = null;
  retried = false;
  update(true);
}

/** Looks at the stores and asks the stage again when what it should read changed. */
export function update(now = false): void {
  if (!layersActive()) {
    stop();
    asked = null;
    const playing = usePlayback.getState().playing && useFilm.getState().stage === 'ready';
    const state = useLayers.getState();
    if (playing && state.state !== 'playing')
      useLayers.setState({ state: 'playing', report: null, pickedId: null, nearId: null, styles: null, choice: EMPTY_LAYER_MOTION_CHOICE });
    else if (!playing && state.state !== 'off' && state.state !== 'playing') useLayers.setState({ state: 'off', nearId: null });
    return;
  }
  const film = useFilm.getState();
  const t = usePlayback.getState().time;
  const stretch = currentStretch();
  // The record as text: a decode parses it anew whatever changed, and only a change to it should read again.
  const record = film.records.retouched === null ? null : serializeRetouchedRecord(film.records.retouched);
  const want = { key: stretch.key, t, revision: film.revision, meta: film.meta, record };
  if (
    !now &&
    asked !== null &&
    asked.key === want.key &&
    asked.t === want.t &&
    asked.revision === want.revision &&
    asked.meta === want.meta &&
    asked.record === want.record
  )
    return;
  const moved = asked !== null && asked.t !== t;
  asked = want;
  const state = useLayers.getState();
  if (state.stretch !== null && state.stretch.key !== stretch.key) {
    useLayers.setState({ report: null, pickedId: null, nearId: null, styles: null, choice: EMPTY_LAYER_MOTION_CHOICE, seen: [], touched: new Set(), stretch });
  }
  if (state.state !== 'reading') useLayers.setState({ state: 'reading' });
  clearTimers();
  retried = false;
  const wait = moved && !seekingToPick && !now ? READ_DEBOUNCE_MS : 0;
  seekingToPick = false;
  if (wait === 0) send(stretch, t);
  else readTimer = setTimeout(() => send(stretch, t), wait);
}

function received(report: LayersReport): void {
  if (pending === null || report.seq !== pending.seq) return;
  const { stretch, t } = pending;
  if (report.rows === null) {
    pending = null;
    if (!retried) {
      retried = true;
      retryTimer = setTimeout(() => {
        if (layersActive()) send(stretch, t);
      }, RETRY_MS);
    } else useLayers.setState({ state: 'failed' });
    return;
  }
  pending = null;
  const state = useLayers.getState();
  const revision = useFilm.getState().revision;
  const previousRows = state.report?.rows ?? null;
  const was = findLayer(previousRows, state.pickedId);
  const again = was === null ? null : findLayerAgain(was, previousRows, report.rows, state.report?.at === report.at);
  const open = new Set(state.open);
  for (const id of holdersOf(report.rows, again?.id ?? null)) open.add(id);
  const sameFilm = state.revision === revision && state.stretch?.key === stretch.key;
  useLayers.setState({
    state: 'read',
    report,
    stretch,
    revision,
    pickedId: again?.id ?? null,
    nearId: findLayer(report.rows, state.nearId)?.id ?? null,
    open,
    touched: new Set(),
    seen: sameFilm ? state.seen : [],
    ...(again === null ? { choice: EMPTY_LAYER_MOTION_CHOICE } : {}),
  });
  askStyles(again);
  const film = useFilm.getState();
  if (useWorking.getState().readOnlyReason === null && stretchTakesRetouch(stretch, selectSceneReports(film)))
    tellLapsedHides(film.records.retouched?.layers ?? [], report, stretch.scene ?? 'film', `${stretch.scene ?? 'film'}#${stretch.index}`, (title) => toast.add({ title }));
}

/** Asks the stage how the picked line of words is styled (a text's styles are not in the reading). */
function askStyles(row: LayerRow | null): void {
  const report = useLayers.getState().report;
  if (row === null || report === null || row.kind !== 'text' || row.look === null || /[+*]/.test(row.id)) {
    if (useLayers.getState().styles !== null) useLayers.setState({ styles: null });
    return;
  }
  stylesSeq += 1;
  useLayers.setState({ styles: { id: row.id, seq: stylesSeq, state: 'reading', look: useLayers.getState().styles?.id === row.id ? (useLayers.getState().styles?.look ?? null) : null } });
  filmEngine()?.send({ type: 'look', seq: stylesSeq, id: row.id, t: report.at });
}

function looked(message: Extract<StageToHost, { type: 'looked' }>): void {
  const styles = useLayers.getState().styles;
  if (styles === null || styles.seq !== message.seq || styles.id !== message.id) return;
  useLayers.setState({ styles: { ...styles, state: message.look === null ? 'failed' : 'read', look: message.look } });
}

/** Picks a layer (null: none). Picking the picked one again lets it go. A layer not on the picture now is gone to. */
export function pickLayer(row: LayerRow | null, again: 'toggle' | 'keep' = 'toggle'): void {
  const state = useLayers.getState();
  if (row === null || (again === 'toggle' && row.id === state.pickedId)) {
    if (state.pickedId !== null) useLayers.setState({ pickedId: null, styles: null, choice: EMPTY_LAYER_MOTION_CHOICE });
    return;
  }
  if (row.id === state.pickedId) return;
  const open = new Set(state.open);
  for (const id of holdersOf(state.report?.rows ?? null, row.id)) open.add(id);
  useLayers.setState({ pickedId: row.id, open, choice: EMPTY_LAYER_MOTION_CHOICE, styles: null });
  const at = state.report?.at ?? usePlayback.getState().time;
  if (row.box === null || !isLayerOnAt(row, at)) goToLayer(row);
  else askStyles(row);
}

/** Moves the playhead to where a layer is best seen; the layers are read there at once. */
export function goToLayer(row: LayerRow): void {
  seekingToPick = true;
  seekTo(row.at);
}

export function deselectLayer(): boolean {
  if (useLayers.getState().pickedId === null) return false;
  pickLayer(null);
  return true;
}

/** The layer a press at a point on the picture finds (film pixels). */
export function layerAt(point: Omit<LayerHitTest, 'small'>, filmWidth: number, filmHeight: number): LayerRow | null {
  const state = useLayers.getState();
  return hitTestLayers(state.report?.rows ?? null, state.pickedId, { ...point, small: 0.05 * filmWidth * filmHeight });
}

/** Starts reading: listens to the stores and the stage. */
export function startLayerReader(): () => void {
  const stops = [
    useUi.subscribe((state, previous) => {
      if (state.panel !== previous.panel || state.fullscreen !== previous.fullscreen) update();
    }),
    useFilm.subscribe((state, previous) => {
      if (state.stage !== previous.stage || state.meta !== previous.meta || state.revision !== previous.revision || state.clock !== previous.clock || state.records.retouched !== previous.records.retouched)
        update();
    }),
    usePlayback.subscribe((state, previous) => {
      if (state.playing !== previous.playing || state.time !== previous.time) update();
    }),
  ];
  let unlisten: (() => void) | null = null;
  const listen = (): void => {
    if (unlisten !== null) return;
    const engine = filmEngine();
    if (engine === null) return;
    unlisten = engine.onStageMessage((message) => {
      if (message.type === 'layers') received(message.report);
      else if (message.type === 'looked') looked(message);
    });
  };
  listen();
  // The engine may come after the layers are installed.
  const late = useFilm.subscribe(() => listen());
  update();
  return () => {
    stop();
    late();
    unlisten?.();
    for (const each of stops) each();
    asked = null;
    pending = null;
    useLayers.setState({ state: 'off', report: null, pickedId: null, nearId: null, styles: null });
  };
}
