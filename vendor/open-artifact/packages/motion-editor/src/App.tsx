import { useEffect, useRef, type ReactElement } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AllComments, Announcer } from '@open-artifact/editor-kit/react';
import { useAppPhase } from './app/start.ts';
import { OPEN_FAILED, OPENING } from './app/words.ts';
import { useAgentBadge } from './comments/CommentLayer.tsx';
import { filmComments } from './comments/comments.ts';
import { COMMENTS_HINT } from './comments/words.ts';
import { SidePanel } from './panels/SidePanel.tsx';
import { Notices } from './player/Notices.tsx';
import { Player } from './player/Player.tsx';
import { Timeline } from './timeline/Timeline.tsx';
import { setFullscreenTarget } from './transport/fullscreen.ts';
import { Transport } from './transport/Transport.tsx';


function VideoPage(): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const agent = useAgentBadge();
  useEffect(() => {
    setFullscreenTarget(root.current);
    return () => setFullscreenTarget(null);
  }, []);
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-chrome text-chrome-fg">
      <main ref={root} className="relative flex min-w-0 flex-1 flex-col bg-chrome">
        <Notices />
        <Player />
        <Timeline />
        <Transport />
      </main>
      <SidePanel />
      <AllComments comments={filmComments} agent={agent} top={8} hint={COMMENTS_HINT} />
      <Announcer />
    </div>
  );
}

export function App(): ReactElement {
  const phase = useAppPhase((s) => s.phase);
  const error = useAppPhase((s) => s.error);
  switch (phase) {
    case 'starting':
      return (
        <div role="status" className="flex h-dvh items-center justify-center gap-2 bg-chrome text-[13px] text-chrome-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {OPENING}
        </div>
      );
    case 'failed':
      return (
        <div role="alert" className="flex h-dvh flex-col items-center justify-center gap-1 bg-chrome px-6 text-center">
          <p className="text-[15px] font-medium">{OPEN_FAILED}</p>
          {error !== null ? <p className="text-[13px] text-chrome-muted">{error}</p> : null}
        </div>
      );
    case 'ready':
      return <VideoPage />;
    default: {
      const never: never = phase;
      return never;
    }
  }
}
