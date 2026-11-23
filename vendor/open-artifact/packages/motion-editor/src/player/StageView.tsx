import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { filmEngine } from '../engine/engine-context.ts';
import { useFilm } from '../stores/film.ts';
import { useUi } from '../stores/ui.ts';
import { fitBox, type Size } from './fit.ts';
import { useStageOverlays } from './overlays.ts';

const DEFAULT_FILM: Size = { width: 1920, height: 1080 };

/** The film's size: as the stage reported it, else as scenes.json says, else 16:9. */
export function useFilmSize(): Size {
  const width = useFilm((s) => s.meta?.width ?? s.scenes?.width ?? DEFAULT_FILM.width);
  const height = useFilm((s) => s.meta?.height ?? s.scenes?.height ?? DEFAULT_FILM.height);
  return { width, height };
}

/**
 * The picture: the stage's frames in a box letterboxed in the player, with what other parts lay over it. The box
 * stays mounted whatever shows over it, since moving or remounting a frame reloads the film. `under` goes between the
 * frames and the overlays (the click that plays).
 */
export function StageView({ under, children }: { under?: ReactNode; children?: ReactNode }): ReactElement {
  const area = useRef<HTMLDivElement>(null);
  const frames = useRef<HTMLDivElement>(null);
  const film = useFilmSize();
  const playerSize = useUi((s) => s.playerSize);
  const box = useUi((s) => s.stageBox);
  const background = useFilm((s) => s.meta?.background[0] ?? s.scenes?.background ?? 'transparent');
  const overlays = useStageOverlays((s) => s.overlays);

  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) return;
    const measure = (): void => {
      const size = { width: element.clientWidth, height: element.clientHeight };
      const current = useUi.getState().playerSize;
      if (current.width !== size.width || current.height !== size.height) useUi.setState({ playerSize: size });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    useUi.setState({ stageBox: fitBox(playerSize, film) });
  }, [playerSize, film.width, film.height]);

  useEffect(() => {
    const container = frames.current;
    const engine = filmEngine();
    if (container === null || engine === null) return;
    engine.attach(container);
    return () => engine.detach(container);
  }, []);

  const placed = box ?? { left: 0, top: 0, width: 0, height: 0 };
  const scale = film.width > 0 ? placed.width / film.width : 1;
  return (
    <div ref={area} className="absolute inset-0 overflow-hidden bg-stage-ground" data-video-player-area="">
      <div ref={frames} className="absolute" style={{ ...placed, background }} data-video-stage="" />
      {under}
      {overlays.map((overlay) => (
        <div key={overlay.id} className="pointer-events-none absolute *:pointer-events-auto" style={placed} data-video-stage-overlay="">
          {overlay.render({ box: placed, scale, filmWidth: film.width, filmHeight: film.height })}
        </div>
      ))}
      {children}
    </div>
  );
}
