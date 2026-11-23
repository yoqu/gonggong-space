/**
 * `network.ts`: which host names plain http is allowed for. Each case is a host name as a caller passes it (usually a
 * URL's `hostname`, sometimes text a person typed), the expected answer and why. A mistake here sends a daemon's Link
 * token and artifact contents over the internet in clear text, so the cases that must be refused matter most.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpAllowance, isLoopbackHostName, isPrivateNetworkHostName, type HttpAllowance } from '../src/network.ts';

/** [host name, expected, why]. */
const CASES: Array<[string, HttpAllowance, string]> = [
  // ---- this computer
  ['localhost', 'loopback', 'the loopback name'],
  ['LOCALHOST', 'loopback', 'case does not matter'],
  ['localhost.', 'loopback', 'a trailing dot is the same name'],
  ['dev.localhost', 'loopback', '*.localhost is loopback by RFC 6761'],
  ['127.0.0.1', 'loopback', '127/8'],
  ['127.255.255.254', 'loopback', 'all of 127/8'],
  ['::1', 'loopback', 'IPv6 loopback'],
  ['[::1]', 'loopback', 'as a URL writes it'],
  ['[::ffff:127.0.0.1]', 'loopback', 'IPv4-mapped loopback'],
  ['localhost:4900', 'loopback', 'a port is not part of the name'],

  // ---- private IPv4
  ['10.0.0.1', 'private', 'RFC 1918 10/8'],
  ['10.255.255.255', 'private', 'the top of 10/8'],
  ['172.16.0.1', 'private', 'RFC 1918 172.16/12, bottom'],
  ['172.31.255.255', 'private', 'RFC 1918 172.16/12, top'],
  ['172.15.0.1', 'refused', 'just below 172.16/12'],
  ['172.32.0.1', 'refused', 'just above 172.16/12'],
  ['192.168.1.20', 'private', 'RFC 1918 192.168/16'],
  ['192.169.0.1', 'refused', 'next to 192.168/16, public'],
  ['169.254.10.1', 'private', 'IPv4 link-local'],
  ['192.168.1.20:4900', 'private', 'with a port'],
  ['100.64.0.1', 'refused', 'CGNAT 100.64/10 is shared with other customers of a carrier; Tailscale has names and https'],
  ['100.127.255.254', 'refused', 'the top of CGNAT, same reason'],
  ['0.0.0.0', 'refused', 'the unspecified address is not a host to link to'],
  ['8.8.8.8', 'refused', 'a public address'],
  ['10.0.0.1.', 'private', 'the URL standard drops the dot after an IPv4 address'],

  // ---- IPv4 written other ways: judged as the URL standard reads them (that is where fetch connects)
  ['167772161', 'private', 'one decimal number: the URL standard reads 10.0.0.1'],
  ['0x0a.0.0.1', 'private', 'hex first part: 10.0.0.1'],
  ['012.0.0.1', 'private', 'octal 012 is 10 to the URL standard: 10.0.0.1'],
  ['010.0.0.1', 'refused', 'octal 010 is 8: 8.0.0.1, public (a regex would have read 10.0.0.1)'],
  ['10.1', 'private', 'a short form: 10.0.0.1'],
  ['134744072', 'refused', 'one decimal number spelling 8.8.8.8'],
  ['0x08080808', 'refused', 'hex 8.8.8.8'],
  ['１０.0.0.1', 'private', 'full-width digits fold to 10.0.0.1'],
  ['1.2.3.4.5', 'refused', 'not an address, and the URL standard refuses it'],
  ['256.0.0.1', 'refused', 'out of range'],

  // ---- IPv6
  ['fd00::1', 'private', 'unique-local fc00::/7 (fd half)'],
  ['[fc00::1]', 'private', 'unique-local fc00::/7 (fc half)'],
  ['[FD12:3456::1]', 'private', 'case does not matter'],
  ['fe80::1', 'private', 'link-local fe80::/10'],
  ['[febf::1]', 'private', 'the top of fe80::/10'],
  ['[fec0::1]', 'refused', 'deprecated site-local, not link-local'],
  ['[fd00::1.2.3.4]', 'private', 'unique-local with a dotted tail'],
  ['[2001:4860:4860::8888]', 'refused', 'a public IPv6 address'],
  ['[::]', 'refused', 'the unspecified address'],
  ['[::ffff:10.0.0.1]', 'private', 'IPv4-mapped: judged by 10.0.0.1'],
  ['[::ffff:a00:1]', 'private', 'the same, as the URL standard writes it'],
  ['[::ffff:8.8.8.8]', 'refused', 'IPv4-mapped public address'],
  ['[::ffff:100.64.0.1]', 'refused', 'IPv4-mapped CGNAT'],
  ['[::a00:1]', 'refused', 'deprecated IPv4-compatible form: not trusted'],
  ['[64:ff9b::a00:1]', 'refused', 'NAT64 prefix: goes through a translator, not trusted'],
  ['fe80::1%eth0', 'refused', 'a zone id is not a URL host'],
  ['[fe80::1%25eth0]', 'refused', 'nor percent-encoded'],
  ['fd00:evil.com', 'refused', 'a hex-looking first label of a name is not an IPv6 address'],

  // ---- private names
  ['nas.local', 'private', 'mDNS, RFC 6762'],
  ['nas.lan', 'private', 'the common home-router suffix'],
  ['NAS.LAN', 'private', 'case does not matter'],
  ['nas.lan.', 'private', 'a trailing dot is the same name'],
  ['nas.lan:8080', 'private', 'with a port'],
  ['printer.home.arpa', 'private', 'RFC 8375'],
  ['db.corp.internal', 'private', '.internal is reserved by ICANN for private use'],
  ['nas.ｌａｎ', 'private', 'full-width letters fold to nas.lan, the name actually looked up'],
  ['nas', 'private', 'a single label: only a local resolver or a search domain answers it'],
  ['ｎａｓ', 'private', 'full-width single label folds to nas'],
  ['lan', 'private', 'a single label, even if it reads like a suffix'],
  ['nas.', 'refused', 'a single label with a trailing dot is absolute: a top-level domain from the DNS root'],
  ['com.', 'refused', 'a top-level domain'],
  ['ai.', 'refused', 'a top-level domain that has had its own address record'],

  // ---- look-alikes and tricks: never private
  ['10.0.0.1.evil.com', 'refused', 'an address as the first labels of a public name'],
  ['10.0.0.1.attacker.example', 'refused', 'address-in-name only for the two named services'],
  ['192-168-1-20.attacker.example', 'refused', 'dashed form on another domain'],
  ['localhost.evil.com', 'refused', 'localhost as a first label of a public name'],
  ['nas.lan.evil.com', 'refused', '.lan must be the end of the name'],
  ['evil-lan.com', 'refused', 'lan inside a label'],
  ['evillan', 'private', 'single label (no dot): see the single-label rule'],
  ['evil.com#@10.0.0.1', 'refused', 'a fragment trick: not a host name'],
  ['10.0.0.1@evil.com', 'refused', 'user info: the host is evil.com'],
  ['evil.com/10.0.0.1', 'refused', 'a path: not a host name'],
  ['evil.com?.lan', 'refused', 'a query: not a host name'],
  ['evil.com\\.lan', 'refused', 'a backslash: not a host name'],
  ['nas.lan evil.com', 'refused', 'white space: not a host name'],
  ['nas.xn--ln-7kc', 'refused', 'nas.lаn with a Cyrillic а, as punycode'],
  ['nas.lаn', 'refused', 'the same look-alike before punycode'],
  ['xn--lan-9na.com', 'refused', 'a punycode label containing lan'],
  ['nas.lan..', 'refused', 'two trailing dots: an empty label'],
  ['a..lan', 'refused', 'an empty label'],
  ['.lan', 'refused', 'only a suffix'],
  ['', 'refused', 'empty'],
  ['   ', 'refused', 'blank'],
  ['example.com', 'refused', 'a public name'],
  ['oa.example.com', 'refused', 'a public name, even one that resolves to a private address today'],

  // ---- nip.io / sslip.io
  ['10.0.0.1.nip.io', 'private', 'dotted private address'],
  ['app.10.0.0.1.nip.io', 'private', 'with a prefix label'],
  ['192-168-1-20.nip.io', 'private', 'dashed'],
  ['art.192-168-1-20.nip.io', 'private', 'dashed, with a prefix label'],
  ['app-10-0-0-1.sslip.io', 'private', 'dashed inside a label, sslip.io'],
  ['0a000001.nip.io', 'refused', 'hex alone is not relied on (not confirmed for both services)'],
  ['app-c0a80114.nip.io', 'refused', 'nor hex after a dash'],
  ['0a000001.10.0.0.1.nip.io', 'private', 'hex that spells a private address does not disqualify'],
  ['127.0.0.1.nip.io', 'private', 'loopback through DNS counts as private, not loopback'],
  ['8.8.8.8.nip.io', 'refused', 'a public address'],
  ['8-8-8-8.nip.io', 'refused', 'dashed public address'],
  ['08080808.nip.io', 'refused', 'hex public address'],
  ['10.0.0.1.8.8.8.8.nip.io', 'refused', 'spells a public address too: which one the service answers is not ours to guess'],
  ['8.8.8.8.10.0.0.1.nip.io', 'refused', 'the same, the other way round'],
  ['10-0-0-1-8-8-8-8.nip.io', 'refused', 'dashed, two addresses'],
  ['10-0-0-1.8.8.8.8.nip.io', 'refused', 'one dashed, one dotted'],
  ['deadbeef.10.0.0.1.nip.io', 'refused', 'a word that is also eight hex digits spells a public address'],
  ['fd00--1.10-0-0-1.sslip.io', 'refused', 'an IPv6 form the service may answer instead'],
  ['010.0.0.1.nip.io', 'refused', 'a leading zero: octal to some parsers'],
  ['10-0-0-01.nip.io', 'refused', 'a leading zero, dashed'],
  ['100.64.0.1.nip.io', 'refused', 'CGNAT'],
  ['app.nip.io', 'refused', 'no address in it'],
  ['nip.io', 'refused', 'the service itself'],
  ['10.0.0.1.nip.io.evil.com', 'refused', 'the service name inside a public name'],
  ['10.0.0.1.evilnip.io', 'refused', 'a domain that only ends with the letters nip.io'],
  ['10.0.0.1.NIP.IO.', 'private', 'case and a trailing dot do not matter'],
];

test('which host names may use plain http (table)', () => {
  for (const [host, expected, why] of CASES) {
    assert.equal(httpAllowance(host), expected, `${JSON.stringify(host)}: ${why}`);
    assert.equal(isLoopbackHostName(host), expected === 'loopback', `${JSON.stringify(host)} loopback: ${why}`);
    assert.equal(isPrivateNetworkHostName(host), expected !== 'refused', `${JSON.stringify(host)} private: ${why}`);
  }
});

test('a URL\'s hostname gets the same answer as the text it came from', () => {
  // Callers pass `new URL(x).hostname`; whatever the URL standard makes of the text must be judged the same way.
  for (const [host, expected, why] of CASES) {
    let url: URL;
    try {
      url = new URL(`http://${host}/`);
    } catch {
      continue;
    }
    // Text that is not a bare host name parses as some other host (or a path): its URL host is judged on its own.
    if (/[\s/?#@\\]/.test(host.trim()) || !host.trim()) continue;
    assert.equal(httpAllowance(url.hostname), expected, `${JSON.stringify(host)} -> ${url.hostname}: ${why}`);
  }
});

test('the tricks are refused as URLs too', () => {
  for (const raw of ['http://evil.com#@10.0.0.1', 'http://10.0.0.1@evil.com/', 'http://evil.com/10.0.0.1', 'http://10.0.0.1.evil.com/', 'http://localhost.evil.com/', 'http://nas.lаn/']) {
    assert.equal(httpAllowance(new URL(raw).hostname), 'refused', raw);
  }
});
