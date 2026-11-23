import { useMemo } from 'react';
import { sceneBuildSummary, type SceneBuildSummary } from '@open-artifact/motion-core';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';

/** What the working bar shows of a film written scene by scene, or `null` when it is done (or not made of scenes). */
export function useSceneSummary(): SceneBuildSummary | null {
  const scenes = useFilm((s) => s.scenes);
  const reports = useFilm((s) => s.meta?.scenes ?? null);
  const working = useWorking((s) => s.activity === 'working');
  const readOnly = useWorking((s) => !s.canAsk);
  return useMemo(() => sceneBuildSummary(scenes, reports, working, readOnly), [scenes, reports, working, readOnly]);
}
