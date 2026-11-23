import { buildVideoViewContext, playSeconds, type VideoViewContext, type VideoViewMode } from '@open-artifact/motion-core';

export interface ViewInputs {
  panel: string | null;
  time: number;
  playing: boolean;
  sceneKey: string | null;
  dirty: boolean;
  handEditRecords: readonly string[];
}

/** The mode a panel puts the page in: Export is `export`, any other panel `tweaks`, none `player`. */
export function viewMode(panel: string | null): VideoViewMode {
  if (panel === null) return 'player';
  return panel === 'export' ? 'export' : 'tweaks';
}

/** The context to publish; the playhead's place only while paused (it means little mid-play). */
export function videoViewContext(inputs: ViewInputs): VideoViewContext {
  return buildVideoViewContext({
    mode: viewMode(inputs.panel),
    dirty: inputs.dirty,
    selected: [],
    handEditRecords: inputs.handEditRecords,
    ...(inputs.playing ? {} : { at: playSeconds(inputs.time) }),
    ...(inputs.sceneKey !== null ? { scene: inputs.sceneKey } : {}),
  });
}
