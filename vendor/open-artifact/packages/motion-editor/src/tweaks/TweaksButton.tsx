import type { ReactElement } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { togglePanel } from '../panels/registry.ts';
import { useUi } from '../stores/ui.ts';
import { TWEAKS_PANEL } from './panel-id.ts';
import { HIDE_PROPERTIES, PROPERTIES, SHOW_PROPERTIES } from './words.ts';

/** The toolbar's Properties button: opens the panel, or closes it. */
export function TweaksButton(): ReactElement {
  const open = useUi((s) => s.panel === TWEAKS_PANEL);
  return <ToolButton label={PROPERTIES} tip={open ? HIDE_PROPERTIES : SHOW_PROPERTIES} shortcut="Mod+\" size="lg" pressed={open} icon={<SlidersHorizontal />} onClick={() => togglePanel(TWEAKS_PANEL)} />;
}
