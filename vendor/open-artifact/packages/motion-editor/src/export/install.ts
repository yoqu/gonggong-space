/** Puts Export and the shape menu next to it on the toolbar. */

import { createElement } from 'react';
import { TOOLBAR_ORDER, registerToolbarItem } from '../transport/slots.ts';
import { ExportButton } from './ExportButton.tsx';
import { closeExport } from './run.ts';
import { watchScore } from './score-file.ts';
import { ShapeMenu } from './ShapeMenu.tsx';

/** Just after Export, before Comments. */
const SHAPE_ORDER = TOOLBAR_ORDER.export + 1;

export function installExport(): () => void {
  const stops = [
    registerToolbarItem({ id: 'export', side: 'end', order: TOOLBAR_ORDER.export, render: () => createElement(ExportButton) }),
    registerToolbarItem({ id: 'shape', side: 'end', order: SHAPE_ORDER, render: () => createElement(ShapeMenu) }),
    watchScore(),
  ];
  return () => {
    closeExport();
    for (const stop of stops) stop();
  };
}
