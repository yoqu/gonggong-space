/**
 * Working with the agent and other viewers: the view context published as
 * presence (what this viewer has on screen, through the shared presence
 * controller of `@open-artifact/editor-kit`), "Ask agent", "Ask agent to fix"
 * for held slides, the agent's working status, and following: a peer, the
 * agent (the slides it writes), or "Follow me" (everyone else follows this
 * viewer, and sees how many do).
 *
 * Everything taken from the artifact (slide text, labels, error messages)
 * was written by someone and is fenced as untrusted data before it is sent.
 * Only what the viewer typed goes in as their own words.
 */

import {
  buildFixRequest,
  buildViewContext,
  contextId,
  contextKind,
  nodeAt,
  nodeLabel,
  sectionGroups,
  sectionKeyOfSlide,
  sectionsOf,
  slideTitle,
  validateViewContext,
  type SlidesViewContext,
} from '@open-artifact/slides-core';
import { fenceUntrusted, type AgentSendResult, type AgentStatus, type Peer } from '@open-artifact/runtime';
import { agentResultMessage, createPresence, sendFailure, watchAgentStatus, type PeerView as KitPeerView } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { create } from 'zustand';
import { deckOrder, isDirty, useDeck } from '../state/deck.ts';
import { useView } from '../state/view.ts';
import { session } from './session.ts';
import { followOnPeers, followPeer, followPresence, setLead } from './follow.ts';

/** A peer with the view context it published (`state`: the slide it is looking at…). */
export type PeerView = KitPeerView<SlidesViewContext>;

/** `following` value for the agent when it publishes no presence: the slides it writes are followed. */
export const FOLLOW_AGENT = '@agent';

interface AgentState {
  status: AgentStatus;
  /** The peer whose slide this viewer follows ({@link FOLLOW_AGENT}: the agent's writing). */
  following: string | null;
  /** Following because that peer asked everyone to follow them ("Follow me"). */
  followingLead: boolean;
  /** This viewer asked everyone else to follow them. */
  leading: boolean;
  /** How many others follow this viewer. */
  followers: number;
  /** A leader this viewer stopped following: not followed again until they ask anew. */
  dismissedLead: string | null;
  follow(id: string | null): void;
  setLeading(on: boolean): void;
}

/** Live agent status and follow state. */
export const useAgent = create<AgentState>()((set, get) => ({
  status: { available: false, busy: false, name: 'Agent' },
  following: null,
  followingLead: false,
  leading: false,
  followers: 0,
  dismissedLead: null,
  follow(id) {
    // Leaving a leader by choice: do not follow them again until they ask anew.
    set(followPeer(get(), id));
  },
  setLeading(on) {
    set(setLead(get(), on));
  },
}));

/** The peer (or the agent) followed, by name. */
export function followedName(state: Pick<AgentState, 'following' | 'status'>, peers: readonly PeerView[]): string | null {
  if (!state.following) return null;
  if (state.following === FOLLOW_AGENT) return state.status.name;
  return peers.find((p) => p.id === state.following)?.name ?? null;
}

/** Follows the agent: its own presence when it publishes one, else the slides it writes. */
export function followAgent(): void {
  const peers = usePresence.getState().peers;
  useAgent.getState().follow(peers.find((p) => p.kind === 'agent' && p.state?.slideId)?.id ?? FOLLOW_AGENT);
}

/** Someone else wrote these slides: a viewer following the agent sees the last one while it works. */
export function followAgentWrites(ids: readonly string[]): void {
  const state = useAgent.getState();
  if (!state.following || !state.status.busy) return;
  const target = state.following === FOLLOW_AGENT ? null : usePresence.getState().peers.find((p) => p.id === state.following);
  if (state.following !== FOLLOW_AGENT && target?.kind !== 'agent') return;
  const slides = useDeck.getState().slides;
  const last = [...ids].reverse().find((id) => slides[id]);
  if (last) showFollowed(last);
}

/** The view context of this viewer right now. */
export function currentViewContext(): SlidesViewContext {
  const view = useView.getState();
  const deck = useDeck.getState();
  const order = deckOrder(deck);
  const mode = view.presenting ? 'present' : view.mode === 'edit' ? 'edit' : 'grid';
  const slideId = view.current && deck.slides[view.current] ? view.current : null;
  const entry = slideId ? deck.slides[slideId] : undefined;
  const selected: { id: string; kind: ReturnType<typeof contextKind>; label?: string }[] = [];
  if (mode === 'edit' && entry) {
    for (const path of view.selection) {
      const node = nodeAt(entry.slide, path);
      if (!node) continue;
      const cell = view.textEdit && view.textEdit.cell && view.textEdit.path.join('.') === path.join('.') ? view.textEdit.cell : undefined;
      const id = contextId(entry.slide, path, cell);
      if (!id) continue;
      const label = nodeLabel(node);
      selected.push({ id, kind: cell ? 'cell' : contextKind(node), ...(label ? { label } : {}) });
    }
  } else if (mode === 'grid') {
    for (const id of view.slideSelection) {
      const slide = deck.slides[id]?.slide;
      if (!slide) continue;
      const label = slideTitle(slide);
      selected.push({ id, kind: 'slide', ...(label ? { label } : {}) });
    }
  }
  const groups = sectionGroups(sectionsOf(deck.index), order);
  return buildViewContext({
    mode,
    slideId,
    slideTitle: entry ? slideTitle(entry.slide) : undefined,
    slideIndex: slideId ? order.indexOf(slideId) + 1 : 0,
    slideCount: order.length,
    dirty: isDirty(deck),
    edits: deck.edits,
    selected,
    held: entry?.held,
    selectedSlides: mode === 'edit' ? order.filter((id) => view.slideSelection.includes(id)) : undefined,
    gridSelectedCount: view.slideSelection.length,
    sections: view.sectionSelection,
    slideSections: view.slideSelection.map((id) => sectionKeyOfSlide(groups, id)),
    editingSection: view.editingSection,
  });
}

/** The deck's presence: this viewer's view context under `viewContext` (no pointer; grid cursors go as room messages, cursors.ts). */
export const slidesPresence = createPresence<SlidesViewContext>({
  key: 'viewContext',
  snapshot: currentViewContext,
  parse: validateViewContext,
  watch(changed) {
    const offView = useView.subscribe((state, previous) => {
      if (
        state.selection !== previous.selection ||
        state.current !== previous.current ||
        state.mode !== previous.mode ||
        state.presenting !== previous.presenting ||
        state.slideSelection !== previous.slideSelection ||
        state.sectionSelection !== previous.sectionSelection ||
        state.editingSection !== previous.editingSection ||
        state.textEdit !== previous.textEdit
      ) {
        changed();
      }
    });
    const offDeck = useDeck.subscribe((state, previous) => {
      if (state.edits !== previous.edits || state.save !== previous.save || state.slides !== previous.slides) changed();
    });
    return () => {
      offView();
      offDeck();
    };
  },
  sendMs: 300,
  onPeers: (peers, self) => followOnRoom(peers, self),
});

/** Peers (people first, then agents) and what they look at. */
export const usePresence = slidesPresence.store;

/** The room's peers changed: follow a new leader, drop one who left, count followers. */
function followOnRoom(peers: readonly Peer[], self: string | null): void {
  const views = usePresence.getState().peers;
  const outcome = followOnPeers(useAgent.getState(), peers, self, [FOLLOW_AGENT]);
  const { following, followingLead, leading, dismissedLead } = outcome.state;
  useAgent.setState({ followers: outcome.followers, following, followingLead, leading, dismissedLead });
  // Someone asked everyone to follow them.
  const leader = outcome.joinedLeader ? views.find((p) => p.id === outcome.joinedLeader) : undefined;
  if (leader) toast.add({ title: `Following ${leader.name}`, description: 'They asked everyone to follow them. Press Esc to stop.' });
  const target = following && following !== FOLLOW_AGENT ? views.find((p) => p.id === following) : undefined;
  if (target) followTo(target);
}

/** Publishes the view context whenever what it describes changes; tracks peers, following and the agent. */
export function startPresence(): void {
  const { room, agent } = session();
  void slidesPresence.start({ room });
  if (room) {
    // Who this viewer follows, and whether they lead, go out at once (not with the view context's throttle).
    useAgent.subscribe((state, previous) => {
      if (state.following === previous.following && state.leading === previous.leading) return;
      room.presence(followPresence(state, [FOLLOW_AGENT])).catch(() => undefined);
    });
  }
  watchAgentStatus(agent, (status) => useAgent.setState({ status }));
  useAgent.subscribe((state, previous) => {
    if (state.following && state.following !== previous.following) {
      const target = usePresence.getState().peers.find((p) => p.id === state.following);
      if (target) followTo(target);
    }
  });
}

/** Shows the slide a followed peer is on. */
function followTo(peer: PeerView): void {
  const slideId = peer.state?.slideId;
  if (slideId) showFollowed(slideId);
}

/** Shows a followed slide (unless this viewer is typing). */
function showFollowed(slideId: string): void {
  const view = useView.getState();
  if (useDeck.getState().slides[slideId] && view.current !== slideId && !view.textEdit) {
    if (view.mode !== 'edit') view.setMode('edit');
    view.showSlide(slideId);
  }
}

/** Describes a send result to the viewer. */
function reportResult(result: AgentSendResult): void {
  toast.add(agentResultMessage(result, 'this deck', useAgent.getState().status));
}

/** Sends the viewer's request with what they have selected. */
export async function sendToAgent(message: string): Promise<AgentSendResult | null> {
  const { agent } = session();
  const text = message.trim();
  if (!agent || !text) return null;
  const context = currentViewContext();
  const parts = [text];
  if (context.selection?.length) {
    // Labels are slide text: fenced, never instructions.
    const listed = context.selection.map((item) => `${item.id} (${item.kind})${item.label ? `: ${item.label}` : ''}`).join('\n');
    parts.push(fenceUntrusted(listed, { label: 'selected elements' }));
  } else if (context.selectedSlides?.length) {
    parts.push(`Selected slides: ${context.selectedSlides.join(', ')}`);
  } else if (context.slideId) {
    parts.push(`Current slide: ${context.slideId} (${context.slideIndex} of ${context.slideCount})`);
  }
  try {
    const result = await agent.send({ title: 'Ask agent', text: parts.join('\n\n'), context: { view: context as unknown as Record<string, unknown> } });
    reportResult(result);
    return result;
  } catch (error) {
    reportResult(sendFailure(error));
    return null;
  }
}

/** Hands the errors of held slides to the agent. */
export async function askAgentToFix(slideIds: readonly string[]): Promise<void> {
  const { agent } = session();
  if (!agent) return;
  const deck = useDeck.getState();
  const errors = slideIds
    .map((slide) => ({
      slide,
      messages: (deck.slides[slide]?.diagnostics ?? []).filter((d) => d.level === 'error').map((d) => (d.line ? `line ${d.line}: ${d.message}` : d.message)),
    }))
    .map((entry) => (entry.messages.length || !deck.slides[entry.slide]?.held ? entry : { ...entry, messages: [deck.slides[entry.slide]!.held!] }))
    .filter((entry) => entry.messages.length);
  if (errors.length === 0) return;
  const files = errors.map((e) => `project/slides/${e.slide}.html`).join(', ');
  const text = [`Fix the errors that hold ${files} read-only.`, fenceUntrusted(buildFixRequest(errors), { label: 'slide errors' })].join('\n\n');
  try {
    reportResult(await agent.send({ title: 'Ask agent to fix', text, context: { slides: errors.map((e) => e.slide) } }));
  } catch (error) {
    reportResult(sendFailure(error));
  }
}
