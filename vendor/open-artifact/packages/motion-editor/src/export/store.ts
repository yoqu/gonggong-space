/** The export dialog's state: what is picked, the estimate for it, and where an export stands. */

import type { ExportFormat, ExportProblem } from '@open-artifact/motion-core';
import type { ExportEstimate, ExportedFile, GifPresetName, HeldFrames } from '@open-artifact/motion-export';
import { create } from 'zustand';
import type { Delivery } from './deliver.ts';
import { defaultVideoOptions, type ExportFormatId, type VideoOptions } from './options.ts';
import { OWN_SHAPE, type ShapeChoice } from './shapes.ts';

/** Why there is no estimate: the browser cannot make the format, a sample frame failed, or the samples were slow. */
export type NoEstimate = 'unsupported' | 'failed' | 'film' | 'slow';

export type EstimateState =
  | { kind: 'none' }
  | { kind: 'busy' }
  | { kind: 'ready'; estimate: ExportEstimate }
  | { kind: 'missing'; why: NoEstimate };

/** What the export is doing now: the phase the progress names, and how far it is. */
export interface Progress {
  phase: 'probe' | 'audio' | 'frames' | 'mux' | 'files' | null;
  done: number;
  total: number;
}

/** A problem the agent can be asked to fix: the export's own words for it and the file it was in. */
export interface FixableProblem {
  problem: ExportProblem;
  format: ExportFormat;
}

export type ExportStep =
  | { kind: 'options' }
  | { kind: 'confirm'; seconds: number }
  | { kind: 'running'; format: ExportFormatId; progress: Progress }
  | {
      kind: 'done';
      format: ExportFormatId;
      filename: string;
      delivery: Delivery;
      held: HeldFrames | null;
      fix: FixableProblem | null;
      leftOut: { fonts: readonly string[]; files: readonly string[] };
    }
  | {
      kind: 'failed';
      format: ExportFormatId;
      title: string;
      message: string;
      fix: FixableProblem | null;
      /** The settings may be made smaller to get past it. */
      smaller: boolean;
      /** A finished file the host would not take, which the browser can still download. */
      file: ExportedFile | null;
    };

export interface ExportState {
  open: boolean;
  format: ExportFormatId;
  video: VideoOptions;
  gif: GifPresetName;
  shape: ShapeChoice;
  step: ExportStep;
  estimate: EstimateState;
  /** null while the browser is being checked. */
  videoAvailable: boolean | null;
}

export const OPTIONS_STEP: ExportStep = { kind: 'options' };

export const useExport = create<ExportState>()(() => ({
  open: false,
  format: 'video',
  video: defaultVideoOptions(30),
  gif: 'standard',
  shape: OWN_SHAPE,
  step: OPTIONS_STEP,
  estimate: { kind: 'none' },
  videoAvailable: null,
}));

/** The dialog is busy with an export and may not be closed by a click outside it. */
export const isRunning = (state: Pick<ExportState, 'step'>): boolean => state.step.kind === 'running';
