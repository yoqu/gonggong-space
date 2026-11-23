/**
 * Side panels later parts of the page add (Properties, Theme…). A panel registers once at start; the side panel area
 * shows the open one (Properties and Theme as tabs of one panel, see `panel-view.ts`), and Mod+\ opens the last one
 * open (else the first by order) or closes it. A tab that comes and goes says what it has to show
 * ({@link reportPanelContent}).
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { FilmState } from '../stores/film.ts';
import { useUi } from '../stores/ui.ts';
import type { PanelContent } from './panel-view.ts';

export interface PanelEntry {
  id: string;
  /** The panel's title, as its toolbar button and its tab name it. */
  label: string;
  order: number;
  /** Shown only while this holds of the film (Style: a film with scenes); always when left out. */
  when?: (film: FilmState) => boolean;
  /**
   * Stays rendered, hidden, while another tab of its group is on show or while its own tab is left out, so it can
   * keep saying what it has to show (Theme).
   */
  keepMounted?: boolean;
  render: () => ReactNode;
}

interface PanelsState {
  panels: readonly PanelEntry[];
  /** What the tabs that come and go said they have to show; one not here has something. */
  content: ReadonlyMap<string, PanelContent>;
}

export const usePanels = create<PanelsState>()(() => ({ panels: [], content: new Map() }));

/** What panel `id` has to show; `null` takes back what it said (it has something again). */
export function reportPanelContent(id: string, content: PanelContent | null): void {
  usePanels.setState((state) => {
    if ((state.content.get(id) ?? null) === content) return state;
    const next = new Map(state.content);
    if (content === null) next.delete(id);
    else next.set(id, content);
    return { content: next };
  });
}

/** What panel `id` has to show, as it last said. */
export const panelContent = (content: ReadonlyMap<string, PanelContent>, id: string): PanelContent => content.get(id) ?? 'has';

/** Adds a panel; returns a function that takes it away. */
export function registerPanel(entry: PanelEntry): () => void {
  usePanels.setState((state) => ({ panels: [...state.panels.filter((known) => known.id !== entry.id), entry].sort((a, b) => a.order - b.order) }));
  return () => {
    usePanels.setState((state) => ({ panels: state.panels.filter((known) => known !== entry) }));
    if (useUi.getState().panel === entry.id) useUi.getState().openPanel(null);
  };
}

/** Opens the panel `id` (or the last one open), or closes it when it is open. */
export function togglePanel(id?: string): void {
  const { panel, lastPanel, openPanel } = useUi.getState();
  const { panels } = usePanels.getState();
  const wanted = id ?? (panels.some((entry) => entry.id === lastPanel) ? lastPanel : (panels[0]?.id ?? null));
  if (wanted === null) return;
  openPanel(panel === wanted ? null : wanted);
}
