/**
 * The agent that owns the board: whether it can be reached and is working,
 * and sending it requests. Every on-board "Ask" entry ends here; the agent
 * answers by writing to the board's store, never through this page.
 */

import { create } from 'zustand';
import { watchAgentStatus } from '@open-artifact/editor-kit';
import type { AgentRequest, AgentSendResult } from '@open-artifact/runtime';
import { maybeSession } from './session.ts';

export interface AgentState {
  /** An agent can receive requests. */
  available: boolean;
  /** The agent is changing this artifact right now. */
  busy: boolean;
  /** Display name, e.g. `Agent`. */
  name: string;
  /** false: an idle agent is not woken; what is sent waits until the person next talks to it. */
  wakesIdle?: boolean;
}

export const useAgent = create<AgentState>()(() => ({ available: false, busy: false, name: 'Agent' }));

/** Follows the agent's status; returns a function that stops. */
export function watchAgent(): () => void {
  return watchAgentStatus(maybeSession()?.agent, (status) => useAgent.setState({ available: status.available, busy: status.busy, name: status.name || 'Agent', wakesIdle: status.wakesIdle }));
}

/** When this page last sent the agent a request (epoch ms; 0 before the first). */
let lastAskAt = 0;

/** This page sent the agent a request within the last `withinMs` milliseconds. */
export function askedRecently(withinMs: number): boolean {
  return lastAskAt > 0 && Date.now() - lastAskAt <= withinMs;
}

/** Sends a request to the agent (a turn now, or queued while it is away). */
export async function sendToAgent(request: AgentRequest): Promise<AgentSendResult> {
  const agent = maybeSession()?.agent;
  if (!agent) return { status: 'failed', reason: 'No agent is connected to this board.' };
  try {
    lastAskAt = Date.now();
    return await agent.send(request, { deliver: 'send' });
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}
