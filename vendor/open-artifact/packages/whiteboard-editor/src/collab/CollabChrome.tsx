/**
 * Collaboration panels over the board: the Ask panel, the status of
 * requests sent from this page, the comment list, the follow banner and
 * the empty board's guidance.
 *
 * Thread labels, comment text and names are untrusted: rendered as text.
 */

import { LoaderCircle } from 'lucide-react';
import { cn } from '@open-artifact/ui';
import { useAgent } from '../services/agent.ts';
import { usePresence } from '../state/presence.ts';
import { Card, ChromeButton, Tip } from '../ui/chrome.tsx';
import { AskPanel } from './AskPanel.tsx';
import { askStatusLabel, isAskPending } from './ask-status.ts';
import { useAsks, type LocalAsk } from './asks.ts';
import { AllComments } from '@open-artifact/editor-kit/react';
import { useAgentBadge } from './CommentPins.tsx';
import { boardComments } from './comments.ts';
import { EmptyBoard } from './EmptyBoard.tsx';
import { useCollabPeers } from './peers.ts';

/** Most characters of a request shown in its status row. */
const ASK_ROW_CHARS = 60;

function clip(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** One request's status row. */
function AskRow({ ask }: { ask: LocalAsk }) {
  const pending = isAskPending(ask.status);
  const wakesIdle = useAgent((state) => state.wakesIdle);
  return (
    <li className={cn('wb-ask-row', ask.fading && 'wb-ask-row-leaving')} data-status={ask.status}>
      {pending ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" /> : <span className="wb-ask-dot" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{clip(ask.text, ASK_ROW_CHARS)}</span>
      <span className="shrink-0 text-chrome-muted">{askStatusLabel(ask.status, wakesIdle)}</span>
    </li>
  );
}

/** The status of requests sent from this page. */
function AskStatusList() {
  const asks = useAsks((state) => state.asks);
  const list = [...asks.values()].sort((a, b) => a.at - b.at).slice(-4);
  if (list.length === 0) return null;
  return (
    <Card className="wb-ask-status" data-wb-region="ask-status" tabIndex={-1}>
      <ul aria-label="Requests to the agent" aria-live="polite" className="flex w-full flex-col gap-0.5">
        {list.map((ask) => (
          <AskRow key={ask.key} ask={ask} />
        ))}
      </ul>
    </Card>
  );
}

/** The "All comments" panel: the shared one (`@open-artifact/editor-kit`), under the board's top bar. */
function CommentsPanel() {
  const agent = useAgentBadge();
  return <AllComments comments={boardComments} agent={agent} top={60} hint="Turn on Comments, then click the board or drag across an area." />;
}

/** "Following …" or "Follow me is on", with a Stop button. */
function FollowBanner() {
  const following = usePresence((state) => state.following);
  const leading = usePresence((state) => state.leading);
  const peer = useCollabPeers((state) => (following ? state.peers.get(following) : undefined));
  const followers = useCollabPeers((state) => state.peers.size);
  if (following && peer) {
    return (
      <Card className="wb-follow-banner" style={{ ['--wb-peer' as string]: peer.color }} role="status">
        <span className="px-2 text-[13px]">Following {peer.name}</span>
        <Tip label="Stop following. Moving the view yourself stops it too" side="bottom">
          <ChromeButton onClick={() => usePresence.getState().follow(null)}>Stop</ChromeButton>
        </Tip>
      </Card>
    );
  }
  if (leading) {
    return (
      <Card className="wb-follow-banner" role="status">
        <span className="px-2 text-[13px]">{followers > 0 ? 'You asked everyone to follow' : 'Follow me is on'}</span>
        <ChromeButton onClick={() => usePresence.getState().setLeading(false)}>Stop</ChromeButton>
      </Card>
    );
  }
  return null;
}

/** Collaboration panels (place above the board, inside the editor root). */
export function CollabChrome() {
  return (
    <>
      <FollowBanner />
      <CommentsPanel />
      <EmptyBoard />
      <div className="wb-collab-foot">
        <AskStatusList />
        <AskPanel />
      </div>
    </>
  );
}
