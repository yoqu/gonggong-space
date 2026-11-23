/**
 * The Layers section of the Tweaks panel: the layers of the stretch on show while the film is paused, and for the
 * picked layer its Appearance, its text styles and Animate. Takes no props; the Tweaks panel renders it.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Button, Section } from '@open-artifact/ui';
import { findLayer } from '@open-artifact/motion-stage/layers';
import { useFilm } from '../stores/film.ts';
import { AnimateGroup } from './AnimateGroup.tsx';
import { AppearanceGroup } from './AppearanceGroup.tsx';
import { LayerList } from './LayerList.tsx';
import { retryLayers } from './reader.ts';
import { useLayers } from './store.ts';
import { stretchTakesRetouch } from './stretch.ts';
import { TextStyleGroup, textStylesShowInk } from './TextStyleGroup.tsx';
import * as words from './words.ts';

/** "Reading…" shows only once a reading has taken this long. */
const SLOW_READING_MS = 1500;

function useSlow(on: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!on) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_READING_MS);
    return () => clearTimeout(timer);
  }, [on]);
  return slow;
}

function Message({ children, action }: { children: string; action?: ReactElement }): ReactElement {
  return (
    <div className="flex flex-col items-start gap-1.5 px-1 py-1" role="status">
      <p className="text-xs text-fg-subtle">{children}</p>
      {action}
    </div>
  );
}

export function LayersSection(): ReactElement {
  const state = useLayers((s) => s.state);
  const report = useLayers((s) => s.report);
  const stretch = useLayers((s) => s.stretch);
  const pickedId = useLayers((s) => s.pickedId);
  const styles = useLayers((s) => s.styles);
  const scenes = useFilm((s) => s.meta?.scenes ?? null);
  const slow = useSlow(state === 'reading' && report === null);

  const rows = report?.rows ?? null;
  const picked = findLayer(rows, pickedId);
  const retouchable = stretch !== null && stretchTakesRetouch(stretch, scenes);

  let body: ReactElement | null;
  if (state === 'playing') body = <Message>{words.PAUSE_TO_SEE_LAYERS}</Message>;
  else if (state === 'failed')
    body = (
      <>
        <Message
          action={
            <Button size="sm" onClick={retryLayers}>
              {words.TRY_AGAIN}
            </Button>
          }
        >
          {rows === null ? words.COULD_NOT_READ_LAYERS : words.COULD_NOT_UPDATE_LAYERS}
        </Message>
        {rows !== null && report !== null ? <LayerList rows={rows} at={report.at} retouchable={retouchable} /> : null}
      </>
    );
  else if (rows === null || report === null) body = slow ? <Message>{words.READING_LAYERS}</Message> : null;
  else if (rows.length === 0) body = <Message>{words.NO_LAYERS}</Message>;
  else body = <LayerList rows={rows} at={report.at} retouchable={retouchable} />;

  const showsText = picked !== null && retouchable && picked.kind === 'text';
  return (
    <>
      <Section title={words.LAYERS_TITLE}>
        <div data-layers-section="">{body}</div>
      </Section>
      {picked !== null && report !== null && stretch !== null && state !== 'playing' ? (
        <div data-layers-section="" key={picked.id}>
          {showsText ? <TextStyleGroup row={picked} /> : null}
          {retouchable ? <AppearanceGroup layer={picked} inkAbove={showsText && textStylesShowInk(styles?.id === picked.id ? styles.look : null)} /> : null}
          <AnimateGroup row={picked} at={report.at} stretch={stretch} />
        </div>
      ) : null}
    </>
  );
}
