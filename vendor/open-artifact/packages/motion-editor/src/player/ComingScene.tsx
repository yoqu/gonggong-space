import { useMemo, type ReactElement } from 'react';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import * as words from './words.ts';

/** The scene under the playhead that is not made yet, with what scenes.json says of it. */
function useComingScene(): { name: string; desc: string | null } | null {
  const clock = useFilm((s) => s.clock);
  const reports = useFilm((s) => s.meta?.scenes ?? null);
  const scenes = useFilm((s) => s.scenes);
  const index = usePlayback((s) => clock?.partAtPlay(s.time) ?? -1);
  return useMemo(() => {
    const part = clock?.parts[index];
    if (part === undefined || part.key === null || reports === null) return null;
    const report = reports.find((scene) => scene.id === part.key);
    if (report === undefined || (report.state !== 'todo' && report.state !== 'failed')) return null;
    const entry = scenes?.scenes.find((scene) => scene.id === part.key);
    return { name: part.label, desc: entry?.desc ?? null };
  }, [clock, reports, scenes, index]);
}

/** Over the picture while the playhead is in a scene the agent has not made yet. */
export function ComingScene(): ReactElement | null {
  const coming = useComingScene();
  const working = useWorking((s) => s.activity === 'working' && !s.waitsOnYou);
  const agent = useWorking((s) => s.name);
  if (coming === null) return null;
  return (
    <div className="absolute inset-0 z-[4] flex items-center justify-center p-6">
      <div className="flex max-w-sm flex-col gap-1 rounded-xl bg-chrome px-5 py-4 text-center shadow-chrome">
        <span className="text-[11px] font-medium uppercase tracking-wide text-chrome-muted">{words.COMING_UP}</span>
        <span className="text-[15px] font-medium">{coming.name}</span>
        {coming.desc !== null ? <span className="text-[13px] text-chrome-muted">{coming.desc}</span> : null}
        <span className="text-[12px] text-chrome-muted">{working ? words.makingIt(agent) : words.NOT_MADE_YET}</span>
      </div>
    </div>
  );
}
