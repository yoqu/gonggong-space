/**
 * Presence and following in the slides editor: PresenceView.tsx drawn from
 * the shared presence store (peers, with their colors), the agent store
 * (follow state) and the grid cursors.
 */

import { useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { followAgent, followedName, FOLLOW_AGENT, useAgent, usePresence, type PeerView } from '../services/agent.ts';
import { useCursors } from '../services/cursors.ts';
import { FollowingBanner, PeerCursorLayer, PresenceMenu, type PresencePeer } from './PresenceView.tsx';

function presencePeer(peer: PeerView): PresencePeer {
  const where = peer.state?.slideIndex ? `On slide ${peer.state.slideIndex}` : undefined;
  const drawn = { id: peer.id, name: peer.name, kind: peer.kind, color: peer.color };
  return where ? { ...drawn, where } : drawn;
}

function usePresencePeers(): PresencePeer[] {
  const peers = usePresence((s) => s.peers);
  return useMemo(() => peers.map(presencePeer), [peers]);
}

/** The avatars card at the top right, with the follow menu. */
export function PresenceCard(): ReactNode {
  const peers = usePresencePeers();
  const { following, leading, followers, status } = useAgent(useShallow((s) => ({ following: s.following, leading: s.leading, followers: s.followers, status: s.status })));
  const agentPeer = peers.find((p) => p.kind === 'agent');
  const followingAgent = following === FOLLOW_AGENT || (agentPeer !== undefined && following === agentPeer.id);
  return (
    <PresenceMenu
      peers={peers}
      following={following}
      leading={leading}
      followers={followers}
      agent={status.available ? { name: status.name, following: followingAgent } : null}
      onFollow={(id) => useAgent.getState().follow(id)}
      onLead={(on) => useAgent.getState().setLeading(on)}
      onFollowAgent={(on) => (on ? followAgent() : useAgent.getState().follow(null))}
    />
  );
}

/** "Following Ana · Esc to stop" at the top of the stage while following someone. */
export function FollowingPill(): ReactNode {
  const peers = usePresence((s) => s.peers);
  const name = useAgent((s) => followedName(s, peers));
  const leading = useAgent((s) => s.leading);
  const followers = useAgent((s) => s.followers);
  return <FollowingBanner name={name} leading={leading} followers={followers} onStop={() => (name ? useAgent.getState().follow(null) : useAgent.getState().setLeading(false))} />;
}

/** Peers' cursors over one grid tile. */
export function TileCursors({ id }: { id: string }): ReactNode {
  const cursors = useCursors((s) => s.cursors);
  const peers = usePresencePeers();
  const here = useMemo(
    () => Object.entries(cursors).filter(([, cursor]) => cursor.slideId === id).map(([peerId, cursor]) => ({ peerId, x: cursor.x, y: cursor.y })),
    [cursors, id],
  );
  return <PeerCursorLayer cursors={here} peers={peers} />;
}
