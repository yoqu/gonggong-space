/**
 * Stills of a video artifact, drawn as its export draws them, by a headless Chromium driving the tools page (see
 * `./tools`). It needs only Node (22 or later: it uses the built-in WebSocket) and a Chromium: `CHROME_PATH`, else one
 * from Playwright's browser cache, else Chrome or Chromium where the system keeps it. It speaks the DevTools protocol
 * itself, so it installs nothing. Shared by `scripts/stills.mjs` and the `open-artifact stills` command.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RenderMode } from './protocol.ts';
import type { ToolsFiles, ToolsLoad, ToolsLogLine } from './tools/types.ts';

/** A stills request that cannot be met: printed as it is, without a stack. */
export class StillsError extends Error {}

export interface StillsRequest {
  /** The artifact folder: db/ (film/, modules/, assets/) and _blobs/. */
  root: string;
  /** Played seconds. */
  times: number[];
  /** Times the film's own size, above 0 and at most 4. */
  scale: number;
  mode: RenderMode;
  /** Where the PNGs go; a new temporary folder when `null`. */
  out: string | null;
}

export const STILLS_MAX_SCALE = 4;

/** The tools page's file name beside a built `open-artifact` command. */
export const STILLS_TOOLS_PAGE = 'motion-tools.html';

/** Played seconds, comma-separated (`0.8,2.4,5`); `null` when any is not a second of the film. */
export function parseStillTimes(text: string): number[] | null {
  const times = text.split(',').map((part) => (part.trim() === '' ? Number.NaN : Number(part)));
  return times.length > 0 && times.every((t) => Number.isFinite(t) && t >= 0) ? times : null;
}

/** The scale a still is drawn at, or `null` outside (0, 4]. */
export function parseStillScale(text: string | undefined): number | null {
  if (text === undefined) return 1;
  const scale = Number(text);
  return scale > 0 && scale <= STILLS_MAX_SCALE ? scale : null;
}

/** The PNG a time is written to. */
export const stillFileName = (t: number): string => 't_' + t.toFixed(3) + '.png';

const plainFile = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isFile() === true;

/** The film's documents (film/, modules/, assets/; never people's own data/) and the uploads its assets name. */
export function readStillsFilm(root: string, warn: (line: string) => void = () => undefined): Required<Pick<ToolsFiles, 'documents' | 'blobs'>> {
  const db = join(root, 'db');
  if (!plainFile(join(db, 'film', 'meta.json'))) throw new StillsError(root + ' is not a motion artifact: it has no db/film/meta.json.');
  const documents: Record<string, string> = {};
  for (const collection of ['film', 'modules', 'assets']) {
    const folder = join(db, collection);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) {
      if (!name.endsWith('.json')) continue;
      const path = join(folder, name);
      if (!plainFile(path)) {
        warn('skipped ' + path + ': not a plain file');
        continue;
      }
      documents[collection + '/' + name.slice(0, -'.json'.length)] = readFileSync(path, 'utf8');
    }
  }
  const blobs: Record<string, string> = {};
  const uploads = join(root, '_blobs');
  const stored = existsSync(uploads) ? readdirSync(uploads) : [];
  for (const [path, text] of Object.entries(documents)) {
    if (!path.startsWith('assets/')) continue;
    let ref = '';
    try {
      ref = String((JSON.parse(text) as { ref?: unknown }).ref ?? '');
    } catch {
      continue;
    }
    const id = /^\/?_blob\/([0-9a-f]{32})$/.exec(ref)?.[1];
    if (id === undefined || id in blobs) continue;
    const file = stored.find((name) => name === id || name.startsWith(id + '.'));
    if (file !== undefined && plainFile(join(uploads, file))) blobs[id] = readFileSync(join(uploads, file)).toString('base64');
  }
  return { documents, blobs };
}

const safeList = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** A Chrome or Chromium to draw with: `CHROME_PATH`, Playwright's cache, then the system's. */
export function findChromium(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CHROME_PATH) {
    if (existsSync(env.CHROME_PATH)) return env.CHROME_PATH;
    throw new StillsError('CHROME_PATH does not exist: ' + env.CHROME_PATH);
  }
  const caches = [env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright'), '/opt/pw-browsers'].filter(
    (path): path is string => path !== undefined && path !== '' && existsSync(path),
  );
  const found: string[] = [];
  for (const cache of caches) {
    for (const build of safeList(cache).sort().reverse()) {
      const home = join(cache, build);
      if (build.startsWith('chromium_headless_shell-')) for (const sub of safeList(home)) found.push(join(home, sub, 'chrome-headless-shell'));
      else if (build.startsWith('chromium-')) {
        found.push(join(home, 'chrome-linux', 'chrome'), join(home, 'chrome-linux64', 'chrome'));
        for (const sub of safeList(home)) found.push(join(home, sub, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      }
    }
  }
  found.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  );
  const binary = found.find((path) => existsSync(path));
  if (binary === undefined) throw new StillsError('No Chromium found. Set CHROME_PATH to a Chrome or Chromium binary.');
  return binary;
}

// The film's code gets no network: every host resolves to nothing, through a proxy that is not there.
const CHROMIUM_ARGS = [
  '--headless=new',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--mute-audio',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--window-size=1920,1080',
  '--host-resolver-rules=MAP * ^NOTFOUND',
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
];

function launch(binary: string, profile: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(binary, [...CHROMIUM_ARGS, '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((done, fail) => {
    let said = '';
    const timer = setTimeout(() => fail(new Error('Chromium did not start within 30 s:\n' + said.slice(-2000))), 30000);
    child.stderr?.on('data', (chunk: Buffer) => {
      said += String(chunk);
      const url = /DevTools listening on (ws:\/\/\S+)/.exec(said)?.[1];
      if (url === undefined) return;
      clearTimeout(timer);
      done({ child, url });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on('exit', (code) => fail(new Error('Chromium exited (' + String(code) + '):\n' + said.slice(-2000))));
  });
}

interface Browser {
  navigate(to: string): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
  close(): Promise<void>;
}

interface Waiter {
  done(value: unknown): void;
  fail(error: Error): void;
}

interface DevToolsReply {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

/** The DevTools protocol over one WebSocket, commands sent to one page's session. */
async function connect(url: string): Promise<Browser> {
  const socket = new WebSocket(url);
  await new Promise<void>((done, fail) => {
    socket.onopen = () => done();
    socket.onerror = () => fail(new Error('could not reach Chromium at ' + url));
  });
  let id = 0;
  const pending = new Map<number, Waiter>();
  socket.onmessage = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as DevToolsReply;
    const waiter = message.id === undefined ? undefined : pending.get(message.id);
    if (waiter === undefined || message.id === undefined) return;
    pending.delete(message.id);
    if (message.error) waiter.fail(new Error(message.error.message));
    else waiter.done(message.result);
  };
  const send = <T>(method: string, params: object = {}, sessionId?: string): Promise<T> =>
    new Promise<T>((done, fail) => {
      pending.set(++id, { done: (value) => done(value as T), fail });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const { targetId } = await send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  return {
    navigate: (to) => send('Page.navigate', { url: to }, sessionId),
    async evaluate<T>(expression: string): Promise<T> {
      const { result, exceptionDetails } = await send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
    async close() {
      await send('Browser.close').catch(() => undefined);
      socket.close();
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Draws the stills asked for with the tools page's HTML (`buildToolsPage`, or the copy a build ships), printing
 * through `say`: the film's problems, its size and length, each PNG's path, the score's counts and the film's own
 * warnings and errors. Resolves to the exit code: 1 when the film did not load.
 */
export async function drawStills(request: StillsRequest, toolsPage: string, say: (line: string) => void = (line) => console.log(line)): Promise<number> {
  const root = resolve(request.root);
  const files: ToolsFiles = { ...readStillsFilm(root, (line) => console.warn(line)), mode: request.mode };
  const binary = findChromium();
  const work = mkdtempSync(join(tmpdir(), 'film-tools-'));
  const out = request.out === null ? mkdtempSync(join(tmpdir(), 'film-stills-')) : resolve(request.out);
  mkdirSync(out, { recursive: true });
  const page = join(work, 'tools.html');
  writeFileSync(page, toolsPage);
  let child: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    const launched = await launch(binary, join(work, 'profile'));
    child = launched.child;
    browser = await connect(launched.url);
    await browser.navigate(pathToFileURL(page).href);
    for (let i = 0; i < 100 && (await browser.evaluate<string>('typeof window.filmTools')) !== 'object'; i++) await new Promise((next) => setTimeout(next, 100));
    const loaded = await browser.evaluate<ToolsLoad>('window.filmTools.load(' + JSON.stringify(files) + ')');
    for (const problem of loaded.problems) say('problem: ' + problem);
    if ('error' in loaded) throw new Error('the film did not load: ' + loaded.error.message);
    const { width, height, fps, duration, scenes } = loaded.meta;
    say(JSON.stringify({ width, height, fps, duration, scenes }));
    for (const t of request.times) {
      try {
        const png = await browser.evaluate<string>('window.filmTools.frame(' + String(t) + ', { scale: ' + String(request.scale) + ' })');
        const file = join(out, stillFileName(t));
        writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
        say(file);
      } catch (error) {
        say('frame ' + String(t) + ' failed: ' + messageOf(error));
      }
    }
    say('score: ' + JSON.stringify(await browser.evaluate<unknown>('window.filmTools.scoreReport()')));
    for (const line of await browser.evaluate<ToolsLogLine[]>('window.filmTools.consoleLog()')) if (line.level !== 'log') say('film ' + line.level + ': ' + line.text);
    return 0;
  } catch (error) {
    console.error(messageOf(error));
    return 1;
  } finally {
    await browser?.close();
    const running = child;
    if (running !== null && running.exitCode === null)
      await new Promise<void>((done) => {
        running.once('exit', () => done());
        running.kill();
      });
    rmSync(work, { recursive: true, force: true });
  }
}
