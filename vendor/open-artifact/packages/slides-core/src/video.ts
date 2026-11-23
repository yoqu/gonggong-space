/**
 * Links to hosted videos: YouTube, Vimeo, Loom and Google Drive.
 *
 * A slide stores only the provider's video id (`data-video-youtube="<id>"`),
 * never a URL. This module reads a pasted link into that id, checks an id an
 * agent wrote, and builds the player and watch URLs back from it.
 */

import { VIDEO_PROVIDERS, type VideoLink, type VideoProvider } from './model.ts';

/** Display names of the providers. */
export const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  drive: 'Google Drive',
};

/** Longest start offset a link keeps (one day). */
export const MAX_VIDEO_START = 86400;

/** `[id, hash or resource key, start]` of a link: the arguments of a provider's URL builders. */
type Parts = [id: string, key: string | undefined, start: number | undefined];

/** How one provider's links are read, embedded and opened. */
interface ProviderSpec {
  /** Grammar of a stored id. */
  id: RegExp;
  /** Where the id sits in a link of this provider (shown when one is rejected). */
  idHint: string;
  /** Prefix of the provider's player frame URLs. */
  frames: string;
  /** The id in a link to this provider (host lowercased, path, raw query), or undefined. */
  read: (host: string, path: string, query: string) => string | undefined;
  embed: (...parts: Parts) => string;
  watch: (...parts: Parts) => string;
  /** Extra player query that lets the page start playback, given the page origin. */
  startable?: (origin: string | undefined) => string;
  /** Whether a start offset is kept. */
  keepsStart: boolean;
  /** Any stored file plays (not only videos). */
  anyFile?: boolean;
}

function optional(prefix: string, value: string | number | undefined, suffix = ''): string {
  return value === undefined || value === '' ? '' : prefix + String(value) + suffix;
}

function group(pattern: RegExp, text: string): string | undefined {
  return pattern.exec(text)?.[1];
}

/** The raw (not decoded) value of a query parameter. */
function queryParameter(query: string, name: string): string | undefined {
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq) === name) return pair.slice(eq + 1);
  }
  return undefined;
}

const SPECS: Record<VideoProvider, ProviderSpec> = {
  youtube: {
    id: /^(?!videoseries$|live_stream$)[A-Za-z0-9_-]{11}$/,
    idHint: 'the 11 characters after v= or youtu.be/',
    frames: 'https://www.youtube-nocookie.com/embed/',
    read: (host, path, query) => {
      if (host === 'youtu.be') return group(/^\/([^/]+)\/?$/, path);
      if (/^(?:www\.)?youtube-nocookie\.com$/.test(host)) return group(/^\/embed\/([^/]+)\/?$/, path);
      if (!/^(?:(?:www|m|music)\.)?youtube\.com$/.test(host)) return undefined;
      return /^\/watch\/?$/.test(path)
        ? queryParameter(query, 'v')
        : group(/^\/(?:embed|shorts|live|v)\/([^/]+)\/?$/, path);
    },
    embed: (id, _key, start) => `${id}?playsinline=1${optional('&start=', start)}`,
    watch: (id, _key, start) => `https://www.youtube.com/watch?v=${id}${optional('&t=', start, 's')}`,
    startable: (origin) =>
      `enablejsapi=1${origin !== undefined && /^https?:\/\/[^/]+$/.test(origin) ? `&origin=${encodeURIComponent(origin)}` : ''}`,
    keepsStart: true,
  },
  vimeo: {
    id: /^\d{1,12}(?:\/[0-9a-f]{8,40})?$/,
    idHint: 'the number in the link, then a slash and the code after it (or after h=) if the link has one',
    frames: 'https://player.vimeo.com/video/',
    read: (host, path, query) => {
      const site = /^(?:www\.)?vimeo\.com$/.test(host);
      if (!site && host !== 'player.vimeo.com') return undefined;
      const m = (
        site
          ? /^\/(?:channels\/[^/]+\/|(?:showcase|album)\/\d+\/video\/|manage\/videos\/)?(\d+)(?:\/([^/]+))?\/?$/
          : /^\/video\/(\d+)\/?$/
      ).exec(path);
      return m?.[1] === undefined ? undefined : m[1] + optional('/', m[2] ?? queryParameter(query, 'h'));
    },
    embed: (id, key, start) => `${id}?${optional('h=', key, '&')}dnt=1${optional('#t=', start, 's')}`,
    watch: (id, key, start) => `https://vimeo.com/${id}${optional('/', key)}${optional('#t=', start, 's')}`,
    keepsStart: true,
  },
  loom: {
    id: /^[0-9a-f]{32}$/,
    idHint: 'the last 32 characters of the link, before any ?',
    frames: 'https://www.loom.com/embed/',
    read: (host, path) =>
      /^(?:www\.)?loom\.com$/.test(host) ? group(/^\/(?:share|embed)\/(?:[^/]*-)?([^/-]+)\/?$/, path) : undefined,
    embed: (id, _key, start) => id + optional('?t=', start, 's'),
    watch: (id, _key, start) => `https://www.loom.com/share/${id}${optional('?t=', start)}`,
    startable: () => 'autoplay=1',
    keepsStart: true,
  },
  drive: {
    id: /^[A-Za-z0-9_-]{20,80}(?:\/[A-Za-z0-9_-]{8,64})?$/,
    idHint: 'the characters between /file/d/ and the next slash, then a slash and the resourcekey value if the link has one',
    frames: 'https://drive.google.com/file/d/',
    read: (host, path, query) => {
      const id = host === 'drive.google.com' ? group(/^\/file\/d\/([^/]+)(?:\/[a-z]*)?$/, path) : undefined;
      return id === undefined ? undefined : id + optional('/', queryParameter(query, 'resourcekey'));
    },
    embed: (id, key) => `${id}/preview${optional('?resourcekey=', key)}`,
    watch: (id, key) => `https://drive.google.com/file/d/${id}/view${optional('?resourcekey=', key)}`,
    startable: () => 'autoplay=1',
    keepsStart: false,
    anyFile: true,
  },
};

/** True for a provider name. */
export function isVideoProvider(value: unknown): value is VideoProvider {
  return typeof value === 'string' && (VIDEO_PROVIDERS as readonly string[]).includes(value);
}

/** True when `id` is a valid id of `provider`. */
export function isVideoId(provider: VideoProvider, id: unknown): id is string {
  return typeof id === 'string' && SPECS[provider].id.test(id);
}

/** Where the id sits in a link of `provider`. */
export function videoIdHint(provider: VideoProvider): string {
  return SPECS[provider].idHint;
}

/** Whether `provider` keeps a start offset. */
export function videoKeepsStart(provider: VideoProvider): boolean {
  return SPECS[provider].keepsStart;
}

/** Whether `provider` plays any stored file. */
export function videoAcceptsAnyFile(provider: VideoProvider): boolean {
  return SPECS[provider].anyFile === true;
}

/** Whole seconds (1–86400) from a number or a numeric string; undefined for 0 or junk. */
export function normalizeVideoStart(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,7}(?:\.\d+)?$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(n)) return undefined;
  const seconds = Math.min(Math.floor(n), MAX_VIDEO_START);
  return seconds > 0 ? seconds : undefined;
}

/** Validates an untrusted `{provider, id, start?}`. */
export function normalizeVideoLink(link: unknown): VideoLink | undefined {
  if (typeof link !== 'object' || link === null) return undefined;
  const { provider, id, start } = link as { provider?: unknown; id?: unknown; start?: unknown };
  if (!isVideoProvider(provider) || !isVideoId(provider, id)) return undefined;
  const seconds = videoKeepsStart(provider) ? normalizeVideoStart(start) : undefined;
  return seconds !== undefined ? { provider, id, start: seconds } : { provider, id };
}

/** A YouTube-style timestamp (`90`, `1m30s`, `1h2m3s`) in seconds. */
function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const m = /^(?:(\d{1,3})h)?(?:(\d{1,5})m)?(?:(\d{1,7})s?)?$/.exec(value);
  if (!m) return undefined;
  return normalizeVideoStart(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
}

/** Reads a pasted link into a video link; null when no provider recognizes it. */
export function parseVideoUrl(url: string): VideoLink | null {
  const text = url.trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  const m = /^(?:(?:https?:)?\/\/)?([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(text);
  if (!m) return null;
  const host = (m[1] ?? '').toLowerCase();
  const query = m[3] ?? '';
  const start =
    parseTimestamp(queryParameter(query, 't')) ??
    parseTimestamp(queryParameter(query, 'start')) ??
    parseTimestamp(queryParameter(m[4] ?? '', 't'));
  for (const provider of VIDEO_PROVIDERS) {
    const link = normalizeVideoLink({ provider, id: SPECS[provider].read(host, m[2] ?? '', query), start });
    if (link) return link;
  }
  return null;
}

function parts(link: VideoLink): Parts {
  const [id = '', key] = link.id.split('/');
  return [id, key, link.start];
}

/** Prefix of a provider's player frame URLs. */
export function videoFrameBase(provider: VideoProvider): string {
  return SPECS[provider].frames;
}

/** The player frame URL of a link; `origin` (the page's) lets the frame start playback on request. */
export function videoEmbedUrl(link: unknown, origin?: string): string | null {
  const valid = normalizeVideoLink(link);
  if (!valid) return null;
  const spec = SPECS[valid.provider];
  const url = spec.frames + spec.embed(...parts(valid));
  const extra = spec.startable?.(origin);
  return extra === undefined ? url : `${url}${url.includes('?') ? '&' : '?'}${extra}`;
}

/** The provider's own page for a link. */
export function videoWatchUrl(link: unknown): string | null {
  const valid = normalizeVideoLink(link);
  return valid ? SPECS[valid.provider].watch(...parts(valid)) : null;
}

/** A thumbnail URL the provider serves without an API call (YouTube only). */
export function videoThumbnailUrl(link: VideoLink): string | null {
  return link.provider === 'youtube' ? `https://i.ytimg.com/vi/${link.id}/hqdefault.jpg` : null;
}
