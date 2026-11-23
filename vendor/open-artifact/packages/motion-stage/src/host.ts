import { STAGE_CONNECT, STAGE_PROTOCOL_VERSION, isStageToHost } from './protocol.ts';
import type { HostToStage, StageConnect, StageToHost } from './protocol.ts';

/** The frame runs scripts and nothing else: no same origin, no forms, no popups, no top navigation. */
export const STAGE_SANDBOX = 'allow-scripts';

/**
 * A stage on the page's own origin: a clip streams from the page's server and its frames can be read back into a
 * snapshot. The film's code can then reach the page that holds the frame.
 */
export const SAME_ORIGIN_STAGE_SANDBOX = 'allow-scripts allow-same-origin';

/** No camera, microphone, location or screen for the film, whatever origin the frame has. */
export const STAGE_PERMISSIONS = "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'";

/**
 * A same-origin stage loads nothing but what it is given and the page's own server's files: no other host, no
 * workers, frames, plugins, forms or base URL.
 */
export const SAME_ORIGIN_STAGE_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
  "media-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

/** Where the stage runs: an opaque origin of its own, or the page's. */
export type StageOrigin = 'opaque' | 'same';

export const stageSandbox = (origin: StageOrigin): string => (origin === 'same' ? SAME_ORIGIN_STAGE_SANDBOX : STAGE_SANDBOX);

/**
 * A script's text inside a <script> element: a closing tag would end the element early, and a comment opener puts
 * the parser where a later "<script" changes how it ends. Both escapes mean the same in a string, a regular
 * expression or a comment. The patterns are written so that this file's own bundled text holds neither sequence.
 */
export const inScript = (code: string): string => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!-{2}/g, '<\\x21--');

/**
 * The stage's own rules. Under forced colors (a Windows contrast theme) the film keeps its colors: the root and body
 * opt out, and the root's default text takes plain black or white by the theme's scheme, in the film-reset layer that
 * this style names first, so any rule of the film's wins.
 */
const STAGE_CSS =
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;forced-color-adjust:none}' +
  '@media (forced-colors:active){@layer film-reset{html{color:light-dark(#000,#fff)}}}';

/** The frame's whole document: the runtime, run once, before anything else; a same-origin stage under its policy. */
export function stageDocument(runtime: string, origin: StageOrigin = 'opaque'): string {
  const guard =
    origin === 'same' ? `<meta http-equiv="Content-Security-Policy" content="${SAME_ORIGIN_STAGE_POLICY}"><meta name="referrer" content="no-referrer">` : '';
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    guard +
    '<style>' +
    STAGE_CSS +
    '</style>' +
    '</head><body><script>' +
    inScript(runtime) +
    '</script></body></html>'
  );
}

/** The origin the port is posted to: the page's own for a same-origin stage, unless the page's is opaque too. */
export function stageTargetOrigin(origin: StageOrigin, page: string = globalThis.location?.origin ?? 'null'): string {
  return origin === 'same' && page !== 'null' ? page : '*';
}

export interface StagePort {
  send(message: HostToStage): void;
  close(): void;
}

/**
 * Hands the loaded frame its port and listens on it. Call on the frame's load event, once per load: a frame that
 * navigates has lost the film, and the stage takes only the first port it is given.
 */
export function openStagePort(
  frame: HTMLIFrameElement,
  onMessage: (message: StageToHost) => void,
  onRefused?: (data: unknown) => void,
  origin: StageOrigin = 'opaque',
): StagePort | null {
  const target = frame.contentWindow;
  if (!target) return null;
  const channel = new MessageChannel();
  const port = channel.port1;
  port.onmessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (isStageToHost(data)) onMessage(data);
    else onRefused?.(data);
  };
  const connect: StageConnect = { type: STAGE_CONNECT, version: STAGE_PROTOCOL_VERSION };
  // An opaque frame is reached by '*' alone; the port is what is private. A same-origin frame is held to the page's.
  target.postMessage(connect, stageTargetOrigin(origin), [channel.port2]);
  return {
    send(message) {
      port.postMessage(message);
    },
    close() {
      port.onmessage = null;
      port.close();
    },
  };
}
