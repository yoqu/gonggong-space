import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { announce } from '@open-artifact/editor-kit';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { Tabs } from '@open-artifact/ui';
import { useFilm } from '../stores/film.ts';
import { useUi } from '../stores/ui.ts';
import { givesWayTo, panelToggleAnnouncement, panelView } from './panel-view.ts';
import { panelContent, usePanels, type PanelEntry } from './registry.ts';
import { CLOSE_PANEL } from './words.ts';

/** Width of the compact inspector side panel, in pixels. */
export const SIDE_PANEL_WIDTH = 336;

const NO_PANELS: readonly PanelEntry[] = [];

/** The registered panels shown for this film, as a key that changes only when the list does. */
function useShownPanels(): readonly PanelEntry[] {
  const panels = usePanels((s) => s.panels);
  const shownIds = useFilm((film) =>
    panels
      .filter((entry) => entry.when === undefined || entry.when(film))
      .map((entry) => entry.id)
      .join('\u0000'),
  );
  if (shownIds === '') return NO_PANELS;
  const ids = shownIds.split('\u0000');
  return panels.filter((entry) => ids.includes(entry.id));
}

function CloseButton(): ReactElement {
  return <ToolButton label={CLOSE_PANEL} shortcut="Mod+\" tipSide="left" size="md" icon={<X />} onClick={() => useUi.getState().openPanel(null)} />;
}

function Frame({ id, title, children }: { id: string; title: string; children: ReactNode }): ReactElement {
  return (
    <aside aria-label={title} className="flex shrink-0 flex-col border-l border-chrome-line bg-chrome" style={{ width: SIDE_PANEL_WIDTH }} data-video-panel={id}>
      {children}
    </aside>
  );
}

/**
 * The open registered panel beside the player. Properties and Theme are tabs of one panel, named in its head; Theme
 * is listed only while it has something to show, and gives way to Properties when it finds it has nothing.
 */
export function SidePanel(): ReactElement | null {
  const open = useUi((s) => s.panel);
  const content = usePanels((s) => s.content);
  const has = (id: string) => panelContent(content, id);
  const view = panelView(open, useShownPanels(), has);
  const yieldTo = givesWayTo(open, view, has);
  const title = view === null ? null : view.kind === 'single' ? view.panel.label : view.title;
  const shownTitle = useRef<string | null>(null);
  useEffect(() => {
    const message = panelToggleAnnouncement(shownTitle.current, title);
    shownTitle.current = title;
    if (message !== null) announce(message);
  }, [title]);
  useEffect(() => {
    if (yieldTo !== null) useUi.getState().openPanel(yieldTo);
  }, [yieldTo]);
  if (view === null) return null;
  if (view.kind === 'single') {
    return (
      <Frame id={view.panel.id} title={view.panel.label}>
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-chrome-line pr-2 pl-4" data-video-panel-head="">
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">{view.panel.label}</h2>
          <CloseButton />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{view.panel.render()}</div>
      </Frame>
    );
  }
  return (
    <Frame id={view.active.id} title={view.title}>
      <Tabs
        className="min-h-0 flex-1"
        label={view.title}
        value={view.active.id}
        onChange={(id) => useUi.getState().openPanel(id)}
        trailing={<CloseButton />}
        items={view.tabs.map((tab) => ({
          value: tab.id,
          label: tab.label,
          keepMounted: tab.keepMounted,
          content: tab.id === view.active.id || tab.keepMounted === true ? tab.render() : null,
        }))}
      />
      {view.out
        .filter((entry) => entry.keepMounted === true)
        .map((entry) => (
          <div key={entry.id} hidden>
            {entry.render()}
          </div>
        ))}
    </Frame>
  );
}
