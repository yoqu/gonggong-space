/**
 * People's colors that never clash (cursors, selections, frames, avatars):
 * eight colors, picked so people online at once do not share one. Unlike
 * the plain hash of `peerColor` (`presence.ts`), pages here *claim*
 * their color over presence.
 *
 * Alone, a person wears the color their id hashes to ({@link peerColorFromId}),
 * or the one they wore last time. With others online, each page *claims*
 * its color: it publishes `{c, t}` (the color, and when it settled on it;
 * `t` is `null` while it has not). The earliest claim keeps a color
 * ({@link peerColorClaimPrecedes}); a later page that clashes moves on to
 * the next free color in the palette. Pages of the same person adopt that
 * person's earliest claim, so one person keeps one color across tabs.
 *
 * {@link createPeerColorKeeper} runs this for one page:
 * - it settles {@link PEER_COLOR_SETTLE_MS} after the page shows, on the
 *   person's own earlier claim or else the least used free color;
 * - every {@link PEER_COLOR_RECONCILE_MS} (and whenever peers change) it
 *   looks again: an earlier clash moves it on (a few times a minute at most);
 * - a page hidden for {@link PEER_COLOR_RELEASE_MS} gives its claim up.
 *
 * One color stays reserved ({@link NEVER_GIVEN_PEER_COLORS}): the one
 * nearest the agent's, so people never look like the agent.
 *
 * Pure (timers and storage are injected): unit-tested. {@link keptPeerColor}
 * and {@link PEER_COLOR_TIMERS} are the browser's storage and timers for it.
 */

/** The palette. Each reads with {@link inkOnPeerColor} text in light and dark themes. */
export const PEER_COLOR_PALETTE = ['#785ee8', '#dc3c3d', '#019c7f', '#fbb315', '#ce447d', '#10a122', '#257de0', '#d25f25'] as const;

/** A palette color. */
export type PeerColor = (typeof PEER_COLOR_PALETTE)[number];

/** Colors never given to people: the purple nearest the agent's own color. */
export const NEVER_GIVEN_PEER_COLORS: readonly string[] = ['#785ee8'];

/** How long after a page shows it settles its color, ms. */
export const PEER_COLOR_SETTLE_MS = 1500;
/** How often a page looks at its color again, ms. */
export const PEER_COLOR_RECONCILE_MS = 2000;
/** How long a hidden page keeps its claim, ms. */
export const PEER_COLOR_RELEASE_MS = 8000;
/** A gap in the reconcile beat this long means the computer slept, ms. */
const WAKE_GAP_MS = 10_000;
/** Within this long of waking, a hidden page gives its claim up at once, ms. */
const WOKE_RECENTLY_MS = 60_000;
/** Moves on from clashes are counted over this long, ms. */
const BUMP_WINDOW_MS = 60_000;

/** The palette from `start` on (wrapping), without `exclude`. */
export function rotatePeerColors(start: string, exclude: readonly string[] = NEVER_GIVEN_PEER_COLORS): string[] {
  const from = Math.max(0, (PEER_COLOR_PALETTE as readonly string[]).indexOf(start));
  return PEER_COLOR_PALETTE.map((_, offset) => PEER_COLOR_PALETTE[(from + offset) % PEER_COLOR_PALETTE.length]!).filter((color) => !exclude.includes(color));
}

/** A palette color, lower-cased; `undefined` for anything else. */
export function normalizePeerColor(color: unknown): PeerColor | undefined {
  const lower = typeof color === 'string' ? color.toLowerCase() : '';
  return (PEER_COLOR_PALETTE as readonly string[]).includes(lower) ? (lower as PeerColor) : undefined;
}

/** The color an id hashes to (never a reserved one): what a person wears alone. */
export function peerColorFromId(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return rotatePeerColors(PEER_COLOR_PALETTE[hash % PEER_COLOR_PALETTE.length]!)[0] ?? PEER_COLOR_PALETTE[1];
}

/** The color a peer wears: the one it published, else its id's. */
export function peerColorFor(published: unknown, id: string): string {
  return normalizePeerColor(published) ?? peerColorFromId(id);
}

/** Text color on a `#rrggbb` background: near-black where white would read poorly (contrast under 3:1), else white. */
export function inkOnPeerColor(hex: string): '#0b0b0b' | '#ffffff' {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * red + 0.7152 * green + 0.0722 * blue + 0.05) < 3 ? '#0b0b0b' : '#ffffff';
}

/** `color` when free, else the palette color after it worn by the fewest of `taken`. */
export function leastUsedPeerColor(color: string, taken: readonly string[], neverGiven: readonly string[] = NEVER_GIVEN_PEER_COLORS): string {
  if (!neverGiven.includes(color) && !taken.includes(color)) return color;
  const count = (candidate: string): number => taken.filter((item) => item === candidate).length;
  return rotatePeerColors(color, neverGiven).reduce((best, candidate) => (count(candidate) < count(best) ? candidate : best));
}

/** Another page's color claim. */
export interface PeerColorClaim {
  /** The person (their user id). */
  key: string;
  /** The page (peer id). */
  peer: string;
  /** The page is this person's (another tab of theirs). */
  own: boolean;
  /** The color claimed. */
  c: string;
  /** When the page settled on it (epoch ms). */
  t: number;
}

/** True when claim `a` (by `aKey`) came before claim `b` (by `bKey`): earlier, or as early with the smaller key. */
export function peerColorClaimPrecedes(a: { t: number }, aKey: string, b: { t: number }, bKey: string): boolean {
  return a.t < b.t || (a.t === b.t && aKey < bKey);
}

/** Claims, earliest first (see {@link peerColorClaimPrecedes}). */
export function sortPeerColorClaims<T extends { t: number; key: string }>(claims: readonly T[]): T[] {
  const ordered: T[] = [];
  for (const claim of claims) {
    const index = ordered.findIndex((other) => peerColorClaimPrecedes(claim, claim.key, other, other.key));
    ordered.splice(index < 0 ? ordered.length : index, 0, claim);
  }
  return ordered;
}

/** Colors other people claim (this person's other pages aside). */
export function takenPeerColors(claims: readonly PeerColorClaim[]): string[] {
  return claims.filter((claim) => !claim.own).map((claim) => claim.c);
}

/** What a page publishes about its color: `t` is `null` while it has not settled. */
export interface PublishedPeerColor {
  c: string;
  t: number | null;
}

/** Options of {@link createPeerColorKeeper}. */
export interface PeerColorKeeperOptions {
  /** This person's id (it hashes to the first color tried, and breaks ties). */
  id: string;
  /** This page's peer id (breaks ties between this person's pages). */
  peer: string;
  /** Publishes this page's claim. */
  publish(claim: PublishedPeerColor): void;
  /** Other pages' claims (this page left out; agents left out). */
  claims(): readonly PeerColorClaim[];
  /** The color this person settled on last time. */
  kept: { read(): string | null; write(color: string): void };
  now(): number;
  /** Runs `run` once after `ms`; returns a function that cancels. */
  after(run: () => void, ms: number): () => void;
  /** Runs `run` every `ms`; returns a function that stops. */
  every(run: () => void, ms: number): () => void;
  /** Colors never given (default {@link NEVER_GIVEN_PEER_COLORS}). */
  neverGiven?: readonly string[];
}

/** Keeps one page's color. */
export interface PeerColorKeeper {
  /** The color this page wears now. */
  worn(): string;
  /** Call when other pages' claims changed. */
  heard(): void;
  /** Call when the page shows (and once at start, when it is visible). */
  here(): void;
  /** Call when the page is hidden. */
  away(): void;
  dispose(): void;
}

/** Keeps one page's color (see the module comment); `onChange` is told when it changes. */
export function createPeerColorKeeper(options: PeerColorKeeperOptions, onChange: () => void = () => {}): PeerColorKeeper {
  const { now } = options;
  const neverGiven = options.neverGiven ?? NEVER_GIVEN_PEER_COLORS;
  const keptColor = normalizePeerColor(options.kept.read());
  let worn = leastUsedPeerColor(keptColor !== undefined && !neverGiven.includes(keptColor) ? keptColor : peerColorFromId(options.id), [], neverGiven);
  let wornSince: number | null = null;
  let bumps = 0;
  let lastBumpAt = -Infinity;
  let cancelSettle: (() => void) | undefined;
  let pendingRelease: { at: number; cancel(): void } | undefined;
  let lastTick = now();
  let lastWakeAt = -Infinity;
  let lastPublished: string | undefined;

  const tickWoke = (): boolean => {
    const at = now();
    const woke = at - lastTick > WAKE_GAP_MS;
    if (woke) lastWakeAt = at;
    lastTick = at;
    return woke;
  };
  const wear = (color: string, since: number | null): void => {
    const changed = color !== worn;
    [worn, wornSince] = [color, since];
    if (since !== null) options.kept.write(worn);
    const published = `${worn} ${String(wornSince)}`;
    if (published !== lastPublished) {
      lastPublished = published;
      options.publish({ c: worn, t: wornSince });
    }
    if (changed) onChange();
  };
  const release = (): void => {
    pendingRelease?.cancel();
    pendingRelease = undefined;
    wear(worn, null);
  };

  /** Usable claims, one per person and kind (their earliest page's). */
  const claimsOf = (all: readonly PeerColorClaim[]): PeerColorClaim[] => {
    const usable = all.filter((claim) => !neverGiven.includes(claim.c));
    return usable.filter((b) => !usable.some((a) => a !== b && a.key === b.key && a.own === b.own && peerColorClaimPrecedes(a, a.peer, b, b.peer)));
  };
  /** Someone else claimed `color` before `claim`. */
  const clashes = (claims: readonly PeerColorClaim[], color: string, claim: { t: number }): boolean =>
    claims.some((other) => !other.own && other.c === color && peerColorClaimPrecedes(other, other.key, claim, options.id));
  /**
   * The color to move to from `color`: every clashing claim, earliest first,
   * takes the next free color, and this page gets what is left.
   */
  const resolveClash = (all: readonly PeerColorClaim[], claims: readonly PeerColorClaim[], color: string, claim: { t: number }): string | undefined => {
    const self: PeerColorClaim = { key: options.id, peer: options.peer, own: true, c: color, t: claim.t };
    const ordered = sortPeerColorClaims([...claims.filter((other) => !other.own), self]);
    const clashing = ordered.filter((a) => a === self || ordered.some((b) => b !== a && b.c === a.c && peerColorClaimPrecedes(b, b.key, a, a.key)));
    const taken = new Set([color, ...takenPeerColors(all)]);
    for (const entry of clashing) {
      const next = rotatePeerColors(entry.c, neverGiven).find((candidate) => !taken.has(candidate));
      if (next === undefined || entry === self) return next;
      taken.add(next);
    }
    return undefined;
  };

  const settle = (): void => {
    cancelSettle = undefined;
    const all = options.claims();
    const claims = claimsOf(all);
    const own = claims.find((claim) => claim.own);
    if (own === undefined) wear(leastUsedPeerColor(worn, takenPeerColors(all), neverGiven), now());
    else wear((clashes(claims, own.c, own) ? resolveClash(all, claims, own.c, own) : undefined) ?? own.c, own.t);
  };
  const reconcile = (): void => {
    if (pendingRelease !== undefined) return;
    const all = options.claims();
    const claims = claimsOf(all);
    const own = claims.find((claim) => claim.own);
    if (wornSince === null) {
      if (own !== undefined && own.c !== worn) wear(own.c, null);
      return;
    }
    const mine = { t: wornSince };
    // This person's earlier page wins (unless its color clashes and can move).
    if (own !== undefined && peerColorClaimPrecedes(own, own.peer, mine, options.peer) && !(clashes(claims, own.c, own) && resolveClash(all, claims, own.c, own) !== undefined)) {
      if (own.c !== worn || own.t !== wornSince) wear(own.c, own.t);
      return;
    }
    if (now() - lastBumpAt > BUMP_WINDOW_MS) bumps = 0;
    const next = clashes(claims, worn, mine) && bumps < rotatePeerColors(worn, neverGiven).length ? resolveClash(all, claims, worn, mine) : undefined;
    if (next === undefined) return;
    [bumps, lastBumpAt] = [bumps + 1, now()];
    wear(next, wornSince);
  };

  const stopTicking = options.every(() => {
    if (tickWoke() && pendingRelease !== undefined) release();
    reconcile();
  }, PEER_COLOR_RECONCILE_MS);

  lastPublished = `${worn} null`;
  options.publish({ c: worn, t: null });

  return {
    worn: () => worn,
    heard: reconcile,
    here() {
      const pending = pendingRelease;
      pendingRelease = undefined;
      pending?.cancel();
      const expired = pending !== undefined && now() - pending.at >= PEER_COLOR_RELEASE_MS;
      if (expired) wear(worn, null);
      if (pending !== undefined && !expired) return reconcile();
      if (cancelSettle !== undefined || wornSince !== null) return;
      bumps = 0;
      wear(worn, null);
      cancelSettle = options.after(settle, PEER_COLOR_SETTLE_MS);
    },
    away() {
      cancelSettle?.();
      cancelSettle = undefined;
      if (wornSince === null || pendingRelease !== undefined) return;
      tickWoke();
      if (now() - lastWakeAt < WOKE_RECENTLY_MS) return wear(worn, null);
      pendingRelease = { at: now(), cancel: options.after(release, PEER_COLOR_RELEASE_MS) };
    },
    dispose() {
      if (pendingRelease !== undefined) release();
      cancelSettle?.();
      cancelSettle = undefined;
      stopTicking();
    },
  };
}

/** The color a person settled on last time, kept in local storage under `key` (wrapped: storage may be missing or refuse). */
export function keptPeerColor(key: string): PeerColorKeeperOptions['kept'] {
  return {
    read(): string | null {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(color: string): void {
      try {
        globalThis.localStorage?.setItem(key, color);
      } catch {
        // Not kept: the id's color is used next time.
      }
    },
  };
}

/** The real clock and timers for {@link createPeerColorKeeper}. */
export const PEER_COLOR_TIMERS: Pick<PeerColorKeeperOptions, 'now' | 'after' | 'every'> = {
  now: () => Date.now(),
  after(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  every(run, ms) {
    const timer = setInterval(run, ms);
    return () => clearInterval(timer);
  },
};
