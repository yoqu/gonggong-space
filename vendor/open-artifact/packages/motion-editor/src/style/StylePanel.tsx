import { useLayoutEffect, type ReactElement } from 'react';
import { reportPanelContent } from '../panels/registry.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { FontSection } from './FontSection.tsx';
import { PaletteSection } from './PaletteSection.tsx';
import { STYLE_PANEL_ID } from './style-ids.ts';
import { themeContent } from './theme-content.ts';
import { useFonts } from './use-fonts.ts';
import { usePalette } from './use-palette.ts';
import { FILM_STOPPED, FINDING_STYLE, NOTHING_TO_STYLE, NO_ANIMATION_YET } from './words.ts';

function Message({ children }: { children: string }): ReactElement {
  return <p className="px-4 py-4 text-[13px] leading-5 text-chrome-muted">{children}</p>;
}

/**
 * The Theme tab: the film's palette and its typefaces, picked by hand.
 * It stays rendered while the side panel is open on Properties too, so its previews run and its tab can come and go.
 */
export function StylePanel(): ReactElement {
  const hasScript = useFilm((state) => state.hasScript);
  const stopped = useFilm((state) => state.stage === 'error');
  const agent = useWorking((state) => state.name);
  const working = useWorking((state) => state.activity === 'working');
  const palette = usePalette(hasScript && !stopped);
  const fonts = useFonts();
  // A film that sets no text has no Font section.
  const fontRows = fonts.rows !== null && fonts.rows.length > 0 ? fonts.rows : null;
  const content = themeContent({ hasScript, stopped, sections: palette.view !== null || fontRows !== null, looking: palette.looking, working });
  // Said before paint, so the tab comes or goes with the frame that shows the panel.
  useLayoutEffect(() => reportPanelContent(STYLE_PANEL_ID, content), [content]);
  useLayoutEffect(() => () => reportPanelContent(STYLE_PANEL_ID, null), []);

  if (!hasScript) return <Message>{NO_ANIMATION_YET}</Message>;
  if (stopped) return <Message>{FILM_STOPPED(agent)}</Message>;
  if (palette.view === null && fontRows === null) return <Message>{palette.looking ? FINDING_STYLE : NOTHING_TO_STYLE(agent)}</Message>;
  return (
    <div className="flex flex-col gap-5 px-4 py-3">
      {palette.view === null ? null : <PaletteSection view={palette.view} canEdit={palette.canEdit} />}
      {palette.looking ? (
        <p role="status" className="-mt-3 text-[13px] text-chrome-muted">
          {FINDING_STYLE}
        </p>
      ) : null}
      {fontRows === null ? null : <FontSection rows={fontRows} canEdit={fonts.canEdit} />}
    </div>
  );
}
