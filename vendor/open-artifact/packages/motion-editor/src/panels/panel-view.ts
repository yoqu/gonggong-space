/** Which registered panels the side panel shows, and how: a group of tabs under one title, or one panel. Pure. */

import { PROPERTIES_AND_THEME_TITLE, panelClosed, panelOpened } from './words.ts';

export interface PanelTab {
  id: string;
  label: string;
}

/** Panels shown together as tabs of one side panel, under one title. */
export interface PanelGroup {
  title: string;
  ids: readonly string[];
}

/**
 * What a tab that comes and goes has to show: `has` something (its tab is listed), `wait` (it is still looking, or
 * held by an error or the agent's work: its tab stays while open, else is left out), or `none` (its tab is left out,
 * and gives way to the group's first while open). A panel that never says is `has`.
 */
export type PanelContent = 'has' | 'wait' | 'none';

export const PROPERTIES_AND_THEME: PanelGroup = { title: PROPERTIES_AND_THEME_TITLE, ids: ['tweaks', 'style'] };
export const PANEL_GROUPS: readonly PanelGroup[] = [PROPERTIES_AND_THEME];

/** A group's tabs (with the one on show, the name of them all, and the group's panels left out), or one panel alone. */
export type PanelView<P extends PanelTab> = { kind: 'tabs'; title: string; tabs: P[]; active: P; out: P[] } | { kind: 'single'; panel: P };

const HAS = (): PanelContent => 'has';

/**
 * What to show for the open panel `open` among the `shown` ones (registered, in order, and shown for this film), as
 * `content` says each has something. A group shows its tabs that have something, and the open one while it waits;
 * when the open one is not among them, the group's first stands in. A group of one tab is named after it.
 */
export function panelView<P extends PanelTab>(
  open: string | null,
  shown: readonly P[],
  content: (id: string) => PanelContent = HAS,
  groups: readonly PanelGroup[] = PANEL_GROUPS,
): PanelView<P> | null {
  if (open === null) return null;
  const group = groups.find((entry) => entry.ids.includes(open));
  if (group === undefined) {
    const panel = shown.find((entry) => entry.id === open);
    return panel === undefined ? null : { kind: 'single', panel };
  }
  const members = shown.filter((entry) => group.ids.includes(entry.id));
  const listed = (entry: P): boolean => {
    const has = content(entry.id);
    return has === 'has' || (has === 'wait' && entry.id === open);
  };
  const tabs = members.filter(listed);
  const active = tabs.find((entry) => entry.id === open) ?? tabs[0];
  if (active === undefined) return null;
  const out = members.filter((entry) => !listed(entry));
  return { kind: 'tabs', title: tabs.length === 1 ? active.label : group.title, tabs, active, out };
}

/** The tab the open panel `open` gives way to, when it has nothing to show (`none`); `null` when it stays. */
export function givesWayTo<P extends PanelTab>(open: string | null, view: PanelView<P> | null, content: (id: string) => PanelContent): string | null {
  if (open === null || view === null || view.kind !== 'tabs' || view.active.id === open) return null;
  return content(open) === 'none' ? view.active.id : null;
}

/** What a screen reader hears when the side panel opens or closes; `null` while it stays open or stays closed. */
export function panelToggleAnnouncement(wasTitle: string | null, nextTitle: string | null): string | null {
  if (wasTitle === null && nextTitle !== null) return panelOpened(nextTitle);
  if (wasTitle !== null && nextTitle === null) return panelClosed(wasTitle);
  return null;
}
