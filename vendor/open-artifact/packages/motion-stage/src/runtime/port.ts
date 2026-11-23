import { STAGE_PROTOCOL_VERSION, isHostToStage, isStageConnect } from '../protocol.ts';
import type { HostToStage, StageToHost } from '../protocol.ts';

// Taken before the film runs: a film may replace MessagePort's methods to read or drop what the stage says.
const realPost = MessagePort.prototype.postMessage;
const realParent = window.parent;
const MOST_QUEUED = 200;

let port: MessagePort | null = null;
const queued: StageToHost[] = [];

/** Never with a transfer list: building one runs Array.prototype[Symbol.iterator], which a film can make throw. */
function post(to: MessagePort, message: StageToHost): void {
  try {
    Reflect.apply(realPost, to, [message]);
  } catch {
    // The browser refused to clone it: dropped.
  }
}

/** What the stage says before the host's port has come waits for it. */
export function say(message: StageToHost): void {
  if (port) post(port, message);
  else if (queued.length < MOST_QUEUED) queued.push(message);
}

/**
 * The host posts the port to this window once, on the frame's load. The frame is sandboxed with allow-scripts only,
 * so the port is the one way in: the first one from the parent is kept, any other ignored.
 */
export function connect(onMessage: (message: HostToStage) => void): void {
  const take = (event: MessageEvent): void => {
    if (port || event.source !== realParent || !isStageConnect(event.data)) return;
    const given = event.ports[0];
    if (!given) return;
    port = given;
    window.removeEventListener('message', take, true);
    given.onmessage = (incoming: MessageEvent): void => {
      if (isHostToStage(incoming.data)) onMessage(incoming.data);
    };
    post(given, { type: 'hello', version: STAGE_PROTOCOL_VERSION });
    for (const message of queued.splice(0)) post(given, message);
  };
  window.addEventListener('message', take, true);
}
