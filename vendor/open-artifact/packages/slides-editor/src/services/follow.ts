/**
 * Following, as plain state transitions (no stores, no room): who this
 * viewer follows, whether they asked everyone to follow them ("Follow me"),
 * and what changes when the room's peers change. Each peer publishes
 * `{ following, lead }` in its presence; services/agent.ts wires this to
 * the room and the slides view.
 */

/** This viewer's follow state. */
export interface FollowState {
  /** The peer followed (or an editor's own key for "the agent's writing"). */
  following: string | null;
  /** Following because that peer asked everyone to ("Follow me"). */
  followingLead: boolean;
  /** This viewer asked everyone to follow them. */
  leading: boolean;
  /** A leader this viewer stopped following: not followed again until they ask anew. */
  dismissedLead: string | null;
}

/** A peer as the room reports it: its id and published presence. */
export interface FollowPeer {
  id: string;
  state: Readonly<Record<string, unknown>>;
}

export const NO_FOLLOW: FollowState = { following: null, followingLead: false, leading: false, dismissedLead: null };

/** Follows `id` (null: stop). Leaving a leader by choice dismisses them; following someone stops leading. */
export function followPeer(state: FollowState, id: string | null): FollowState {
  const dismissedLead = state.followingLead && state.following && state.following !== id ? state.following : state.dismissedLead;
  return { ...state, following: id, followingLead: false, dismissedLead, leading: id ? false : state.leading };
}

/** Starts or stops "Follow me" (leading stops following). */
export function setLead(state: FollowState, on: boolean): FollowState {
  return on ? { ...state, leading: true, following: null, followingLead: false } : { ...state, leading: false };
}

/** What this viewer publishes in its presence (`ownKeys`: following values that are not peers). */
export function followPresence(state: FollowState, ownKeys: readonly string[] = []): { following: string | null; lead: true | null } {
  const following = state.following && !ownKeys.includes(state.following) ? state.following : null;
  return { following, lead: state.leading ? true : null };
}

/** What the room's peers change. */
export interface PeersOutcome {
  state: FollowState;
  /** Others following this viewer. */
  followers: number;
  /** A leader this viewer started following just now (to tell the person). */
  joinedLeader: string | null;
}

/**
 * The follow state after the peers changed: a leader who stopped leading
 * loses their followers, a dismissed leader who stopped is forgotten, a
 * new leader is followed (unless this viewer follows someone or leads), and
 * a followed peer who left is no longer followed. `ownKeys` are following
 * values that are not peers (kept as they are).
 */
export function followOnPeers(state: FollowState, peers: readonly FollowPeer[], selfId: string | null, ownKeys: readonly string[] = []): PeersOutcome {
  const others = peers.filter((p) => p.id !== selfId);
  const followers = selfId ? others.filter((p) => p.state.following === selfId).length : 0;
  const leaders = others.filter((p) => p.state.lead === true);
  let next = { ...state };
  if (next.dismissedLead && !leaders.some((p) => p.id === next.dismissedLead)) next.dismissedLead = null;
  if (next.following && next.followingLead && !leaders.some((p) => p.id === next.following)) next = { ...next, following: null, followingLead: false };
  let joinedLeader: string | null = null;
  const leader = leaders.find((p) => p.id !== next.dismissedLead);
  if (!next.following && !next.leading && leader) {
    next = { ...next, following: leader.id, followingLead: true };
    joinedLeader = leader.id;
  }
  if (next.following && !ownKeys.includes(next.following) && !others.some((p) => p.id === next.following)) {
    next = { ...next, following: null, followingLead: false };
  }
  return { state: next, followers, joinedLeader };
}
