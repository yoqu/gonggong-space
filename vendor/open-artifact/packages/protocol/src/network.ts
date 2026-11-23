/**
 * Which host names plain `http` is allowed for. A cloud host and the daemon's link to it use `https`, except on this
 * computer and on a private network the person trusts (a home or office LAN), where an Open Artifact host often has no
 * certificate. Both are decided by the host NAME as written, never by resolving it: a public name that happens to
 * resolve to a private address is still a public name (whoever controls its DNS decides where it points, today and
 * tomorrow: DNS rebinding), so it is refused unless the person overrides the check on purpose (`--insecure-http`,
 * `OA_ALLOW_HTTP=1`).
 *
 * The name is first read the way the URL standard reads a URL's host (`new URL()`), because that is where `fetch` will
 * connect: `0x0a.0.0.1`, `012.0.0.1` and `167772161` all become `10.0.0.1`, `NAS.LAN.` stays `nas.lan.`, full-width
 * letters fold, `[::ffff:10.0.0.1]` becomes `::ffff:a00:1`. Text that is not a bare host name (a path, `#`, `@`, `?`, a
 * backslash, white space, an IPv6 zone id) is refused rather than reinterpreted.
 *
 * Allowed (`loopback`):
 * - `localhost`, `*.localhost` (RFC 6761), 127/8, `::1`, and `::ffff:127.x.x.x`.
 *
 * Allowed (`private`):
 * - IPv4 10/8, 172.16/12, 192.168/16 (RFC 1918) and link-local 169.254/16; IPv6 unique-local `fc00::/7` (RFC 4193)
 *   and link-local `fe80::/10`; an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is judged by its IPv4 address.
 * - names under `.local` (mDNS, RFC 6762), `.home.arpa` (RFC 8375), `.internal` (reserved by ICANN for private use)
 *   and `.lan` (not reserved, but never delegated and the common home-router suffix);
 * - a single-label name (`nas`), which only a local resolver or a search domain answers. Written with a trailing dot
 *   (`nas.`) it is an absolute name looked up from the DNS root, i.e. a top-level domain, and is refused.
 * - a name under `nip.io` or `sslip.io` (and only those: two named wildcard-DNS services, never "any domain whose
 *   name contains an address") when EVERY address the name could spell is private: `10.0.0.1.nip.io`,
 *   `app.192-168-1-20.nip.io`, `app-10-0-0-1.sslip.io`. A name that also spells a public address
 *   (`10.0.0.1.8.8.8.8.nip.io`, or in hex: `deadbeef.10.0.0.1.nip.io`), an IPv6 address (`--1.sslip.io`), or an
 *   address with a leading zero (octal to one parser, decimal to another) is refused. This trusts those two services
 *   to answer as documented: a residual risk the person accepts by using such a name (whoever runs or hijacks their
 *   DNS decides where the token goes), kept because LAN hosting asked for these names.
 *
 * Refused: everything else, including CGNAT 100.64/10 (shared with other customers of the same carrier; a Tailscale
 * machine is reached by its single-label MagicDNS name or over https), 0.0.0.0, `::`, site-local `fec0::/10`, NAT64
 * `64:ff9b::/96`, IPv4-compatible `::a.b.c.d`, and look-alikes such as `localhost.evil.com`, `10.0.0.1.evil.com`,
 * `nas.lаn` (Cyrillic `а`: `nas.xn--ln-7kc`) and empty labels (`a..lan`, `.lan`).
 *
 * Shared by the daemon (`remote add`), the Shell's connect form and the host's configuration, so they agree.
 */

/** How plain `http` stands for a host name: this computer, a private network (allowed, not encrypted), or refused. */
export type HttpAllowance = 'loopback' | 'private' | 'refused';

type Ipv4 = [number, number, number, number];

/**
 * A host name as the URL standard reads it: lower case, IPv4 in dotted decimal, IPv6 compressed without brackets, a
 * trailing dot kept. `null` when the text is not a bare host name (it holds a path, query, fragment, user info, white
 * space or a zone id) or the URL parser refuses it. A port is allowed and dropped (`nas.lan:4900` -> `nas.lan`).
 */
function canonical(hostname: string): string | null {
  let text = hostname.trim();
  if (!text || /[\s/?#@\\%]/.test(text)) return null;
  // A bare IPv6 address (`fd00::1`): bracketed, as a URL writes it.
  if (!text.startsWith('[') && (text.match(/:/g)?.length ?? 0) >= 2) text = `[${text}]`;
  let host: string;
  try {
    host = new URL(`http://${text}/`).hostname;
  } catch {
    return null;
  }
  return host.replace(/^\[(.*)\]$/, '$1');
}

/** The four numbers of a dotted-decimal IPv4 address (no leading zeros), or `null`. */
function ipv4(text: string): Ipv4 | null {
  const match = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(text);
  if (!match) return null;
  const parts = match.slice(1).map(Number) as Ipv4;
  return parts.every((n) => n <= 255) ? parts : null;
}

/** {@link HttpAllowance} of an IPv4 address. */
function ipv4Allowance([a, b]: Ipv4): HttpAllowance {
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return 'private';
  return 'refused';
}

/** The eight 16-bit words of an IPv6 address in the URL standard's compressed hex form, or `null`. */
function ipv6Words(text: string): number[] | null {
  if (!/^[0-9a-f:]+$/.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const words = (part: string): number[] => (part ? part.split(':').map((w) => (/^[0-9a-f]{1,4}$/.test(w) ? Number.parseInt(w, 16) : Number.NaN)) : []);
  const head = words(halves[0]!);
  const tail = halves.length === 2 ? words(halves[1]!) : [];
  if ([...head, ...tail].some((w) => Number.isNaN(w))) return null;
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/** {@link HttpAllowance} of an IPv6 address (eight words). */
function ipv6Allowance(words: number[]): HttpAllowance {
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words as [number, number, number, number, number, number, number, number];
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0) {
    if (w5 === 0 && w6 === 0 && w7 === 1) return 'loopback';
    // IPv4-mapped (`::ffff:a.b.c.d`): the IPv4 address is where the connection goes.
    if (w5 === 0xffff) return ipv4Allowance([w6 >> 8, w6 & 0xff, w7 >> 8, w7 & 0xff]);
    return 'refused';
  }
  if ((w0 & 0xfe00) === 0xfc00 || (w0 & 0xffc0) === 0xfe80) return 'private';
  return 'refused';
}

/**
 * What counts as "this computer or a private network" for plain http, in words, for the messages that refuse http
 * elsewhere (the host's `OA_APP_ORIGIN`/`OA_CONTENT_ORIGIN`, the daemon's `remote`): one sentence, so they agree with
 * {@link isPrivateNetworkHostName} and each other.
 */
export const PRIVATE_NETWORK_HTTP_RULE =
  'http is only for this computer or a private network: a private address, .local, .lan, .home.arpa, .internal, a one-word name or a nip.io / sslip.io name spelling a private address';

/** Wildcard DNS services that answer a name with the IPv4 address written in it (`10.0.0.1.nip.io`, `app-10-0-0-1.sslip.io`). */
const ADDRESS_IN_NAME_DOMAINS = ['nip.io', 'sslip.io'];

/** Suffixes of names that only a private network answers. */
const PRIVATE_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal'];

/** An IPv4 address spelled with leading zeros somewhere (`010.0.0.1`): octal to some parsers, decimal to others. */
const LEADING_ZERO = /(?:^|[.-])0\d/;

/**
 * Every IPv4 address a `nip.io` / `sslip.io` name could be answered with, or `null` when the name is not under one of
 * them or holds something those services might read differently (an IPv6 address, a leading zero). Dotted
 * (`10.0.0.1.nip.io`, `x.10.0.0.1.nip.io`) and dashed inside a label (`10-0-0-1.nip.io`, `app-10-0-0-1.nip.io`).
 * Every window of four numbers counts, so a name that spells two addresses yields both. A label (or a label's last
 * dashed part) of eight hex digits is read as an address too (`0a000001`), but only to refuse a name that also
 * spells a public one that way: whether a service answers hex is not something this file relies on. Empty when the
 * name spells no dotted or dashed address.
 */
function addressesInName(host: string): Ipv4[] | null {
  const domain = ADDRESS_IN_NAME_DOMAINS.find((d) => host.endsWith(`.${d}`));
  if (!domain) return null;
  const labels = host.slice(0, -(domain.length + 1)).split('.');
  if (labels.some((label) => label.includes('--'))) return null; // sslip.io's IPv6 form (`fd00--1`)
  const found: Ipv4[] = [];
  /** Hex spellings: they only ever disqualify (a service may or may not read them), never make a name private. */
  const hexes: Ipv4[] = [];
  const windows = (numbers: string[]): boolean => {
    for (let i = 0; i + 4 <= numbers.length; i++) {
      const text = numbers.slice(i, i + 4).join('.');
      if (LEADING_ZERO.test(text)) return false;
      const address = ipv4(text);
      if (address) found.push(address);
    }
    return true;
  };
  // Dotted: runs of numeric labels.
  let run: string[] = [];
  for (const label of [...labels, '']) {
    if (/^\d+$/.test(label)) run.push(label);
    else {
      if (!windows(run)) return null;
      run = [];
    }
  }
  for (const label of labels) {
    // Dashed: runs of numeric parts within one label.
    const parts = label.split('-');
    let numbers: string[] = [];
    for (const part of [...parts, '']) {
      if (/^\d+$/.test(part)) numbers.push(part);
      else {
        if (!windows(numbers)) return null;
        numbers = [];
      }
    }
    // Hex: eight hex digits as a label or the label's last dashed part.
    const hex = /^[0-9a-f]{8}$/.test(parts.at(-1) ?? '') ? parts.at(-1)! : null;
    if (hex) {
      const n = Number.parseInt(hex, 16);
      hexes.push([n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
    }
  }
  return found.length ? [...found, ...hexes] : [];
}

/** {@link HttpAllowance} of a host name (see the file's comment for the rule). */
export function httpAllowance(hostname: string): HttpAllowance {
  const host = canonical(hostname);
  if (!host) return 'refused';
  const v4 = ipv4(host);
  if (v4) return ipv4Allowance(v4);
  if (host.includes(':')) {
    const words = ipv6Words(host);
    return words ? ipv6Allowance(words) : 'refused';
  }
  const absolute = host.endsWith('.');
  const name = absolute ? host.slice(0, -1) : host;
  const labels = name.split('.');
  if (labels.some((label) => !label)) return 'refused';
  if (name === 'localhost' || name.endsWith('.localhost')) return 'loopback';
  if (labels.length === 1) return absolute ? 'refused' : 'private';
  if (PRIVATE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return 'private';
  const spelled = addressesInName(name);
  return spelled?.length && spelled.every((address) => ipv4Allowance(address) !== 'refused') ? 'private' : 'refused';
}

/** Whether a host name is this computer: `localhost`, a `*.localhost` name, 127/8, `::1` or `::ffff:127.x.x.x`. */
export function isLoopbackHostName(hostname: string): boolean {
  return httpAllowance(hostname) === 'loopback';
}

/**
 * Whether a host name, as written, names a machine on a private network or this computer ({@link httpAllowance} is
 * not `refused`). Nothing is resolved.
 */
export function isPrivateNetworkHostName(hostname: string): boolean {
  return httpAllowance(hostname) !== 'refused';
}
