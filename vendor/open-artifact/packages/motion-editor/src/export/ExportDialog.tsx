/** The export dialog: its picks or where the export stands, and the buttons for that step. */

import { Button, Dialog } from '@open-artifact/ui';
import type { ReactNode } from 'react';
import { reloadPage, useStaleBuild } from '../app/stale-build.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { ExportOptions } from './ExportOptions.tsx';
import { ExportStatus } from './ExportStatus.tsx';
import { movBlocked } from './options.ts';
import { askToFix, backToOptions, cancelExport, closeExport, downloadInstead, startExport, useSmallerSettings } from './run.ts';
import { chosenShape, shapeIdOf } from './shapes.ts';
import { useExport, type ExportStep } from './store.ts';
import * as words from './words.ts';

function OptionsFooter(): ReactNode {
  const meta = useFilm((state) => state.meta);
  const ready = useFilm((state) => state.stage === 'ready');
  const shape = useExport((state) => state.shape);
  const format = useExport((state) => state.format);
  const videoAvailable = useExport((state) => state.videoAvailable);
  const estimate = useExport((state) => state.estimate);
  const own = meta === null ? null : { width: meta.width, height: meta.height };
  const made = own === null ? null : chosenShape(shape, own);
  const sameShape = shape.kind !== 'own' && made === null;
  const label = made !== null && made !== 'unusable' ? words.makeShapeLabel(shape.kind === 'named' ? shape.id : shapeIdOf(made), made.ratio) : words.EXPORT;
  const movFull = format === 'mov' && estimate.kind === 'ready' && movBlocked(estimate.estimate);
  const blocked = !ready || made === 'unusable' || sameShape || (made === null && ((format === 'video' && videoAvailable !== true) || movFull));
  return (
    <>
      <Button variant="ghost" onClick={closeExport}>
        {words.CANCEL}
      </Button>
      <Button variant="primary" disabled={blocked} onClick={() => void startExport()}>
        {label}
      </Button>
    </>
  );
}

function StepFooter({ step }: { step: Exclude<ExportStep, { kind: 'options' }> }): ReactNode {
  const agent = useWorking((state) => state.name);
  // Trying again in a page whose parts are gone from the server fails the same way; only a reload helps.
  const stale = useStaleBuild((state) => state.stale);
  switch (step.kind) {
    case 'confirm':
      return (
        <>
          <Button variant="ghost" onClick={backToOptions}>
            {words.CANCEL}
          </Button>
          <Button variant="primary" onClick={() => void startExport(true)}>
            {words.EXPORT_ANYWAY}
          </Button>
        </>
      );
    case 'running':
      return <Button onClick={cancelExport}>{words.CANCEL}</Button>;
    case 'done': {
      const fix = step.fix;
      return (
        <>
          {fix !== null ? <Button onClick={() => void askToFix(fix).then(closeExport)}>{words.askToFix(agent)}</Button> : null}
          <Button variant="primary" onClick={closeExport}>
            {words.DONE}
          </Button>
        </>
      );
    }
    case 'failed': {
      const { fix, file } = step;
      return (
        <>
          <Button variant="ghost" onClick={closeExport}>
            {words.CLOSE}
          </Button>
          {fix !== null ? <Button onClick={() => void askToFix(fix).then(closeExport)}>{words.askToFix(agent)}</Button> : null}
          {step.smaller ? <Button onClick={useSmallerSettings}>{words.USE_SMALLER}</Button> : null}
          {file !== null ? (
            <Button variant="primary" onClick={() => downloadInstead(file)}>
              {words.DOWNLOAD_INSTEAD}
            </Button>
          ) : stale ? (
            <Button variant="primary" onClick={reloadPage}>
              {words.RELOAD}
            </Button>
          ) : (
            <Button variant="primary" onClick={backToOptions}>
              {words.TRY_AGAIN}
            </Button>
          )}
        </>
      );
    }
    default: {
      const never: never = step;
      return never;
    }
  }
}

export function ExportDialog(): ReactNode {
  const open = useExport((state) => state.open);
  const step = useExport((state) => state.step);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeExport();
      }}
      title={words.EXPORT}
      className="w-[min(34rem,calc(100vw-2rem))]"
      footer={step.kind === 'options' ? <OptionsFooter /> : <StepFooter step={step} />}
    >
      {step.kind === 'options' ? <ExportOptions /> : <ExportStatus step={step} />}
    </Dialog>
  );
}
