/**
 * Other people (and the agent) for any editor: their pointers, outlines of
 * what they have selected or are editing, in a surface's camera-follow
 * layer; and their avatars.
 *
 * Editor-agnostic: the editor turns
 * its peers' state into world boxes ({@link PeerBox}); these draw them.
 */

import type { ComponentType, ReactElement, ReactNode } from 'react';
import { Bot } from 'lucide-react';
import { Tooltip, cn } from '@open-artifact/ui';
import { AGENT_COLOR, type PeerView } from './presence.ts';
import { screenBox, type Box, type Camera } from './pins.ts';

/** An outline drawn for a peer (or the agent). */
export interface PeerBox {
  key: string;
  color: string;
  /** World box. */
  rect: Box;
  /** A chip over its top-right corner ("Ana is editing", "Agent edited"). */
  label?: string;
  /** The chip carries the agent's mark, and the outline pulses. */
  agent?: boolean;
}

/** Peers' outlines and chips, in screen space. */
export function PeerBoxes({ camera, boxes }: { camera: Camera; boxes: readonly PeerBox[] }): ReactNode {
  return (
    <>
      {boxes.map((b) => {
        const s = screenBox(camera, b.rect);
        return (
          <div key={b.key} className={cn('pointer-events-none absolute rounded-[2px] border-2', b.agent && 'animate-pulse')} style={{ ...s, borderColor: b.color }}>
            {b.label ? (
              <span
                role="status"
                className="absolute -top-6 right-0 flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow"
                style={{ background: b.color }}
              >
                {b.agent ? <Bot className="size-3" /> : null}
                {b.label}
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** Peers' pointers with their names, in screen space. `shown` filters peers (another page…). */
export function PeerCursors<S>({ camera, peers, shown }: { camera: Camera; peers: readonly PeerView<S>[]; shown?(peer: PeerView<S>): boolean }): ReactNode {
  return (
    <>
      {peers.map((peer) => {
        const c = peer.cursor;
        if (!c || (shown && !shown(peer))) return null;
        return (
          <div
            key={`cursor:${peer.id}`}
            className="pointer-events-none absolute transition-[left,top] duration-75 ease-linear"
            style={{ left: c.x * camera.zoom + camera.x, top: c.y * camera.zoom + camera.y }}
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow">
              <path d="M2 1.5 L15 8.5 L9 10 L6.5 16 Z" fill={peer.color} stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span className="absolute left-3.5 top-4 whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-medium text-white" style={{ background: peer.color }}>
              {peer.name}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** Initials of a name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase();
}

function Avatar({ peer, pulse = false }: { peer: { name: string; kind: 'person' | 'agent'; color: string }; pulse?: boolean }) {
  return (
    <span
      className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-chrome,white)] text-[10px] font-semibold text-white', pulse && 'animate-pulse')}
      style={{ background: peer.color }}
    >
      {peer.kind === 'agent' ? <Bot className="size-3.5" /> : initials(peer.name)}
    </span>
  );
}

/** A tooltip component (the editor's own, or the UI package's). */
export type TipComponent = ComponentType<{ label: ReactNode; children: ReactElement<Record<string, unknown>> }>;

/** Most avatars drawn before "+n". */
const MAX_AVATARS = 4;

export interface PresenceAvatarsProps<S> {
  peers: readonly PeerView<S>[];
  /** The agent wrote moments ago (it shows, pulsing, even when it is not a peer). */
  agentWrote: boolean;
  /** What a person's tooltip adds to their name ("editing"). */
  status?(peer: PeerView<S>): string | null;
  /** What the document is called ("design"). */
  noun?: string;
  Tip?: TipComponent;
}

/** Avatars of the people and the agent here now. */
export function PresenceAvatars<S>({ peers, agentWrote, status, noun = 'document', Tip = Tooltip }: PresenceAvatarsProps<S>): ReactNode {
  const people = peers.filter((p) => p.kind === 'person');
  const agentPeer = peers.find((p) => p.kind === 'agent');
  // The agent shows while it is connected as a peer, and for a moment after it writes.
  const agent = agentPeer ?? (agentWrote ? { name: 'Agent', kind: 'agent' as const, color: AGENT_COLOR } : null);
  if (people.length === 0 && !agent) return null;
  const shown = people.slice(0, MAX_AVATARS);
  const more = people.length - shown.length;
  return (
    <div className="flex items-center pl-1 pr-0.5" aria-label="Here now">
      <div className="flex -space-x-1.5">
        {shown.map((peer) => {
          const extra = status?.(peer);
          return (
            <Tip key={peer.id} label={extra ? `${peer.name} · ${extra}` : peer.name}>
              <span className="inline-flex">
                <Avatar peer={peer} />
              </span>
            </Tip>
          );
        })}
        {more > 0 ? (
          <Tip label={people.slice(MAX_AVATARS).map((p) => p.name).join(', ')}>
            <span className="flex size-6 items-center justify-center rounded-full border-2 border-[var(--color-chrome,white)] bg-chrome-line text-[10px] font-semibold text-chrome-fg">+{more}</span>
          </Tip>
        ) : null}
        {agent ? (
          <Tip label={agentWrote ? `${agent.name} just changed this ${noun}` : agent.name}>
            <span className="inline-flex">
              <Avatar peer={agent} pulse={agentWrote} />
            </span>
          </Tip>
        ) : null}
      </div>
    </div>
  );
}
