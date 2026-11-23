/** The export dialog's picks: the file, its settings, and the shape, with the estimate and notes under them. */

import { FILM_SHAPES, FILM_SHAPE_IDS, GIF_SETTINGS, type FilmShapeId } from '@open-artifact/motion-core';
import type { GifPresetName, VideoHeight, VideoQuality } from '@open-artifact/motion-export';
import { NumberInput, Row, Segmented, SwitchInput, type Option } from '@open-artifact/ui';
import type { ReactNode } from 'react';
import { maybeSession } from '../host/session.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { HOST_SAVE_MAX_BYTES } from './deliver.ts';
import {
  describeEstimate,
  frameRates,
  gifSizeAdvice,
  hasClearBackground,
  isMeasured,
  movSizeAdvice,
  offeredFormats,
  unfinishedNote,
  type ExportFormatId,
} from './options.ts';
import { pick } from './run.ts';
import { chosenShape, ratioOf, shapeIdOf, typedStart, type FilmSize, type ShapeChoice } from './shapes.ts';
import { useExport, type EstimateState } from './store.ts';
import * as words from './words.ts';

type ShapeValue = FilmShapeId | 'own' | 'custom';

const QUALITIES: readonly VideoQuality[] = ['high', 'medium', 'low'];
const HEIGHTS: readonly VideoHeight[] = [720, 1080];
const GIF_PRESETS: readonly GifPresetName[] = ['standard', 'small'];
const MEBIBYTE = 1_048_576;

function Note({ tone = 'muted', children }: { tone?: 'muted' | 'warning'; children: ReactNode }): ReactNode {
  return <p className={tone === 'warning' ? 'text-xs text-warning' : 'text-xs text-fg-muted'}>{children}</p>;
}

function shapeValue(choice: ShapeChoice, own: FilmSize): ShapeValue {
  switch (choice.kind) {
    case 'own':
      return shapeIdOf(own) ?? 'own';
    case 'named':
      return choice.id;
    case 'typed':
      return 'custom';
    default: {
      const never: never = choice;
      return never;
    }
  }
}

function ShapeRow({ own }: { own: FilmSize }): ReactNode {
  const shape = useExport((state) => state.shape);
  const agent = useWorking((state) => state.name);
  const ownId = shapeIdOf(own);
  const options: Option<ShapeValue>[] = [
    ...(ownId === null ? [{ value: 'own' as const, label: ratioOf(own), title: words.OWN_SHAPE }] : []),
    ...FILM_SHAPE_IDS.map((id) => ({ value: id, label: words.SHAPE_NAMES[id], title: words.shapeLabel(words.SHAPE_NAMES[id], FILM_SHAPES[id].ratio) })),
    { value: 'custom', label: words.SHAPE_NAMES.custom },
  ];
  const choose = (value: ShapeValue): void => {
    if (value === 'own' || value === ownId) pick({ shape: { kind: 'own' } });
    else if (value === 'custom') pick({ shape: shape.kind === 'typed' ? shape : typedStart(own) });
    else pick({ shape: { kind: 'named', id: value } });
  };
  const made = chosenShape(shape, own);
  return (
    <>
      <Row label={words.SHAPE}>
        <Segmented value={shapeValue(shape, own)} options={options} onChange={choose} aria-label={words.SHAPE} />
      </Row>
      {shape.kind === 'typed' ? (
        <Row label={words.RATIO}>
          <NumberInput className="w-20" value={shape.across} min={1} max={999} aria-label={words.RATIO_ACROSS} onCommit={(across) => pick({ shape: { ...shape, across: across ?? shape.across } })} />
          <span className="text-fg-subtle">:</span>
          <NumberInput className="w-20" value={shape.down} min={1} max={999} aria-label={words.RATIO_DOWN} onCommit={(down) => pick({ shape: { ...shape, down: down ?? shape.down } })} />
        </Row>
      ) : null}
      {made === 'unusable' ? <Note tone="warning">{words.RATIO_HELP}</Note> : null}
      {shape.kind === 'typed' && made === null ? <Note>{words.SAME_SHAPE}</Note> : null}
      {made !== null && made !== 'unusable' ? <Note>{words.shapeSecondAnimation(agent)}</Note> : null}
    </>
  );
}

function VideoRows({ fps, quality = true }: { fps: number; quality?: boolean }): ReactNode {
  const video = useExport((state) => state.video);
  const rates = frameRates(fps);
  const rateOptions: Option<string>[] = [
    { value: String(rates.full), label: words.fpsLabel(rates.full), title: words.FRAME_RATE_TIPS.full },
    { value: String(rates.half), label: words.fpsLabel(rates.half), title: words.FRAME_RATE_TIPS.half },
    ...(rates.quarter !== null ? [{ value: String(rates.quarter), label: words.fpsLabel(rates.quarter), title: words.FRAME_RATE_TIPS.quarter }] : []),
  ];
  return (
    <>
      <Row label={words.RESOLUTION}>
        <Segmented
          value={String(video.height)}
          options={HEIGHTS.map((height) => ({ value: String(height), label: `${height}p` }))}
          onChange={(value) => pick({ video: { ...video, height: value === '1080' ? 1080 : 720 } })}
          aria-label={words.RESOLUTION}
        />
      </Row>
      <Row label={words.FRAME_RATE}>
        <Segmented value={String(video.fps)} options={rateOptions} onChange={(value) => pick({ video: { ...video, fps: Number(value) } })} aria-label={words.FRAME_RATE} />
      </Row>
      {quality ? (
        <Row label={words.QUALITY}>
          <Segmented
            value={video.quality}
            options={QUALITIES.map((each) => ({ value: each, label: words.QUALITY_LABELS[each], title: words.QUALITY_TIPS[each] }))}
            onChange={(each) => pick({ video: { ...video, quality: each } })}
            aria-label={words.QUALITY}
          />
        </Row>
      ) : null}
      <label className="flex items-center gap-2 text-xs">
        <SwitchInput checked={video.supersample} onChange={(supersample) => pick({ video: { ...video, supersample } })} aria-label={words.SUPERSAMPLE} />
        {words.SUPERSAMPLE}
      </label>
    </>
  );
}

interface FilmSizing {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

function EstimateNote({ format, estimate, film, movOffered }: { format: ExportFormatId; estimate: EstimateState; film: FilmSizing; movOffered: boolean }): ReactNode {
  const video = useExport((state) => state.video);
  const gif = useExport((state) => state.gif);
  const videoAvailable = useExport((state) => state.videoAvailable);
  const fps = film.fps;
  if (!isMeasured(format)) return null;
  switch (estimate.kind) {
    case 'none':
      return format === 'video' && videoAvailable === null ? <Note>{words.CHECKING_BROWSER}</Note> : null;
    case 'busy':
      return <Note>{words.ESTIMATING}</Note>;
    case 'missing': {
      const said = { unsupported: movOffered ? words.NO_MP4_HERE : words.NO_VIDEO_HERE, failed: words.ESTIMATE_FAILED, film: words.ESTIMATE_FILM_FAILED, slow: words.ESTIMATE_SLOW }[estimate.why];
      return <Note tone="warning">{said}</Note>;
    }
    case 'ready': {
      const maxBytes = GIF_SETTINGS.maxMb * MEBIBYTE;
      const mov = format === 'mov' ? movSizeAdvice(estimate.estimate, video, film) : null;
      const advice =
        format === 'gif'
          ? gifSizeAdvice(estimate.estimate.bytes, GIF_SETTINGS.heavyMb * MEBIBYTE, maxBytes, gif, videoAvailable === true)
          : mov !== null
            ? `${mov.warning} ${mov.suggestion}`
            : '';
      const downloads = maybeSession()?.downloads;
      const hostCap = downloads != null && downloads.browser !== true && estimate.estimate.bytes > HOST_SAVE_MAX_BYTES;
      return (
        <>
          <Note>{describeEstimate(format, estimate.estimate, video, fps, maxBytes)}</Note>
          {advice !== '' ? <Note tone="warning">{advice}</Note> : null}
          {hostCap ? <Note>{words.overHostLimit(HOST_SAVE_MAX_BYTES / MEBIBYTE)}</Note> : null}
        </>
      );
    }
    default: {
      const never: never = estimate;
      return never;
    }
  }
}

export function ExportOptions(): ReactNode {
  const format = useExport((state) => state.format);
  const gif = useExport((state) => state.gif);
  const shape = useExport((state) => state.shape);
  const estimate = useExport((state) => state.estimate);
  const meta = useFilm((state) => state.meta);
  if (meta === null) return <Note>{words.NOT_READY}</Note>;
  const own = { width: meta.width, height: meta.height };
  const unfinished = unfinishedNote(meta.scenes);
  const ownShape = shape.kind === 'own' || chosenShape(shape, own) === null;
  const formats = offeredFormats();
  const movOffered = formats.includes('mov');
  const blackBehind = movOffered && (format === 'video' || format === 'gif') && hasClearBackground(meta.background);
  return (
    <div className="flex flex-col gap-3">
      <ShapeRow own={own} />
      {ownShape ? (
        <>
          <Row label={words.FORMAT}>
            <Segmented
              value={format}
              options={formats.map((id) => ({ value: id, label: words.FORMAT_LABELS[id], title: words.FORMAT_TIPS[id] }))}
              onChange={(next) => pick({ format: next })}
              aria-label={words.FORMAT}
            />
          </Row>
          {format === 'video' ? <VideoRows fps={meta.fps} /> : null}
          {format === 'mov' ? (
            <>
              <VideoRows fps={meta.fps} quality={false} />
              <Note>{words.MOV_FORMAT_DESCRIPTION}</Note>
            </>
          ) : null}
          {format === 'gif' ? (
            <>
              <Row label={words.SIZE}>
                <Segmented value={gif} options={GIF_PRESETS.map((id) => ({ value: id, label: words.GIF_SIZES[id] }))} onChange={(next) => pick({ gif: next })} aria-label={words.SIZE} />
              </Row>
              <Note>{words.GIF_DESCRIPTION}</Note>
            </>
          ) : null}
          {format === 'zip' ? <Note>{words.ZIP_DESCRIPTION}</Note> : null}
          {format === 'html' ? <Note>{words.HTML_DESCRIPTION}</Note> : null}
          {blackBehind ? <Note>{words.OPAQUE_EXPORT_DESCRIPTION}</Note> : null}
          <EstimateNote format={format} estimate={estimate} film={{ width: meta.width, height: meta.height, fps: meta.fps, duration: meta.duration }} movOffered={movOffered} />
          {unfinished !== null ? <Note tone="warning">{unfinished}</Note> : null}
        </>
      ) : null}
    </div>
  );
}
