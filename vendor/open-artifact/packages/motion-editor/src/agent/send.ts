/**
 * Sends the agent a request through the `agent` capability. Where there is no agent to send to, or sending fails,
 * the request's text goes to the clipboard and the person is told to paste it in the chat.
 */

import { agentResultMessage, sendFailure } from '@open-artifact/editor-kit';
import type { AgentSendResult } from '@open-artifact/runtime';
import { toast } from '@open-artifact/ui';
import { REQUEST_TOASTS, type VideoAgentRequest } from '@open-artifact/motion-core';
import { maybeSession } from '../host/session.ts';
import { useWorking } from '../stores/working.ts';
import { REQUEST_SUBJECT } from './words.ts';

export type RequestOutcome = 'sent' | 'copied' | 'failed';

export interface SendOptions {
  /** A short thing the person could say in the chat instead ("Continue"). */
  say?: string;
}

/** The agent can take requests from this viewer here. */
export function canSendToAgent(): boolean {
  const current = maybeSession();
  return current !== null && current.agent !== null && current.canAsk && useWorking.getState().available;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function copyInstead(request: VideoAgentRequest, options: SendOptions, reason?: string): Promise<RequestOutcome> {
  if (await copyText(request.text)) {
    toast.add({ title: options.say !== undefined ? REQUEST_TOASTS.copiedSay(options.say) : REQUEST_TOASTS.copied, ...(reason ? { description: reason } : {}) });
    return 'copied';
  }
  toast.add({ title: options.say !== undefined ? REQUEST_TOASTS.failedSay(options.say) : REQUEST_TOASTS.failed, description: request.text });
  return 'failed';
}

export async function sendAgentRequest(request: VideoAgentRequest, options: SendOptions = {}): Promise<RequestOutcome> {
  const agent = maybeSession()?.agent ?? null;
  if (agent === null || !canSendToAgent()) return copyInstead(request, options);
  let result: AgentSendResult;
  try {
    result = await agent.send({ title: request.title, text: request.text, ...(request.context !== undefined ? { context: request.context } : {}) }, { deliver: 'send' });
  } catch (error) {
    result = sendFailure(error);
  }
  if (result.status === 'failed') return copyInstead(request, options, result.reason);
  const { name, wakesIdle } = useWorking.getState();
  toast.add(agentResultMessage(result, REQUEST_SUBJECT, { name, wakesIdle }));
  return 'sent';
}
