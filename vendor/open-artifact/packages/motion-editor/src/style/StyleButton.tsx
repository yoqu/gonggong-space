import type { ReactElement } from 'react';
import { Palette } from 'lucide-react';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { togglePanel } from '../panels/registry.ts';
import { useFilm } from '../stores/film.ts';
import { useUi } from '../stores/ui.ts';
import { STYLE_PANEL_ID, showsStyle } from './style-ids.ts';
import { STYLE_TOOLTIP, THEME_LABEL } from './words.ts';

/** The toolbar's Theme button, for films made of scenes. */
export function StyleButton(): ReactElement | null {
  const shown = useFilm(showsStyle);
  const open = useUi((state) => state.panel === STYLE_PANEL_ID);
  if (!shown) return null;
  return <ToolButton label={THEME_LABEL} tip={STYLE_TOOLTIP} size="lg" pressed={open} icon={<Palette />} onClick={() => togglePanel(STYLE_PANEL_ID)} />;
}
