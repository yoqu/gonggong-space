/** Whether the Theme tab has something to show, as the side panel lists its tabs (`panels/panel-view.ts`). Pure. */

import type { PanelContent } from '../panels/panel-view.ts';

export interface ThemeState {
  /** The film has its animation yet. */
  hasScript: boolean;
  /** The film stopped with an error. */
  stopped: boolean;
  /** A palette or typefaces were found to show. */
  sections: boolean;
  /** The palette previews are still being drawn. */
  looking: boolean;
  /** The agent is at work, and may give the film a theme. */
  working: boolean;
}

/**
 * What the Theme tab has to show: its sections; or it waits (no animation yet, an error, the previews being drawn, or
 * the agent at work); or nothing, and gives way to Properties.
 */
export function themeContent(state: ThemeState): PanelContent {
  if (!state.hasScript || state.stopped) return 'wait';
  if (state.sections) return 'has';
  return state.looking || state.working ? 'wait' : 'none';
}
