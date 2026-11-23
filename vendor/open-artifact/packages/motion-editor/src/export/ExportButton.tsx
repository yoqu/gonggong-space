/** The toolbar's Export button, with the dialog it opens. */

import { ToolButton } from '@open-artifact/editor-kit/react';
import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { useFilm } from '../stores/film.ts';
import { ExportDialog } from './ExportDialog.tsx';
import { openExport } from './run.ts';
import * as words from './words.ts';

export function ExportButton(): ReactNode {
  const ready = useFilm((state) => state.stage === 'ready' && state.meta !== null);
  return (
    <>
      <ToolButton label={words.EXPORT} tip={ready ? words.EXPORT : words.EXPORT_UNAVAILABLE} size="lg" disabled={!ready} icon={<Download />} onClick={openExport} />
      <ExportDialog />
    </>
  );
}
