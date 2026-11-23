/**
 * The agent's side of every editor: following its status, and telling the
 * person how the host took a request ("Send to agent", "Ask agent to fix").
 * Pure; the editor shows the message (a toast).
 */

import type { AgentCapability, AgentSendResult, AgentStatus } from '@open-artifact/runtime';

/** A message for the person. */
export interface AgentResultMessage {
  title: string;
  description?: string;
}

/**
 * How the host took a request, for a toast. `subject` names what the agent
 * checks next ("this design", "this deck", "this board"). `agent` is its
 * status: one that is not woken while it idles (`wakesIdle: false`) gets a
 * queued request on its next turn, which the person starts.
 */
export function agentResultMessage(
  result: Pick<AgentSendResult, 'status' | 'reason'>,
  subject: string,
  agent?: Pick<AgentStatus, 'name' | 'wakesIdle'>,
): AgentResultMessage {
  switch (result.status) {
    case 'delivered':
      return { title: 'Sent to the agent' };
    case 'queued':
      if (agent?.wakesIdle === false) {
        const name = agent.name || 'The agent';
        return { title: `Queued for ${name}`, description: `${name} gets it on its next turn. If it is idle, send it a message there to start one.` };
      }
      return { title: 'Queued for the agent', description: `It will see the request the next time it checks ${subject}.` };
    case 'staged':
      return { title: 'Request prepared', description: 'Your agent will ask before acting on it.' };
    default:
      return { title: 'Could not reach the agent', description: result.reason ?? 'Try again, or copy your request into the conversation.' };
  }
}

/** A failed send result for an error thrown while sending. */
export function sendFailure(error: unknown): AgentSendResult {
  return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
}

/** Follows the agent's status (none without an agent); returns a function that stops. */
export function watchAgentStatus(agent: AgentCapability | null | undefined, onStatus: (status: AgentStatus) => void): () => void {
  if (!agent) return () => {};
  let stopped = false;
  agent.status().then(
    (status) => {
      if (!stopped) onStatus(status);
    },
    () => undefined,
  );
  const off = agent.onStatus(onStatus);
  return () => {
    stopped = true;
    off();
  };
}
