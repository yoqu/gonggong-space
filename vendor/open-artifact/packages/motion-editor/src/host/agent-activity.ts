/**
 * Follows the `agent` capability's status into the working store. A busy mark with no agent to do the work is not
 * work, and a short pause between two steps is not the end of it ({@link WORKING_GRACE_MS}). An agent that waits on
 * the person's answer is still at work: it is working, and waits on them.
 */

import type { AgentCapability, AgentStatus } from '@open-artifact/runtime';
import { watchAgentStatus } from '@open-artifact/editor-kit';
import { useWorking } from '../stores/working.ts';

export const WORKING_GRACE_MS = 2000;
/** A request the agent never takes up stops showing as asked after this long. */
export const ASKED_FORGET_MS = 60_000;

export function watchAgentActivity(agent: AgentCapability | null | undefined): () => void {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let askedTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const goIdle = (): void => {
    useWorking.setState({ activity: 'idle', asked: null });
  };
  const stopStatus = watchAgentStatus(agent, (status: AgentStatus) => {
    const waitsOnYou = status.available && status.waitingForPerson === true;
    useWorking.setState({ available: status.available, name: status.name || 'Agent', wakesIdle: status.wakesIdle !== false, waitsOnYou });
    if (status.available && (status.busy || waitsOnYou)) {
      clearIdle();
      useWorking.setState({ activity: 'working' });
      return;
    }
    if (useWorking.getState().activity !== 'working') {
      useWorking.setState({ activity: 'idle' });
      return;
    }
    if (idleTimer === undefined)
      idleTimer = setTimeout(() => {
        idleTimer = undefined;
        goIdle();
      }, WORKING_GRACE_MS);
  });
  const stopAsked = useWorking.subscribe((state, previous) => {
    if (state.asked === previous.asked) return;
    if (askedTimer !== undefined) clearTimeout(askedTimer);
    askedTimer = state.asked === null ? undefined : setTimeout(() => useWorking.setState({ asked: null }), ASKED_FORGET_MS);
  });
  return () => {
    clearIdle();
    if (askedTimer !== undefined) clearTimeout(askedTimer);
    stopAsked();
    stopStatus();
  };
}
