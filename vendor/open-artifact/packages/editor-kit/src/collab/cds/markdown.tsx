/**
 * Markdown in comment bodies: the small subset its comment cards
 * render when the boot flag commentMarkdownEnabled is on. Fenced code, block quotes, ## to ###### headings (bold,
 * not bigger), - / * / 1. lists, inline code, *em*, **strong**, ~~del~~. Links and bare URLs are kept out of emphasis but
 * stay text. Block mode is a thread's card; flat mode (one run of text: quotes in italics, list items as "• " / "1. ")
 * is a row in the "All comments" panel. Same limits, flanking rules and class strings.
 *
 * Left out: @mentions (local comments carry no <mention:…> tokens, so no "@agent" chip and no reply that starts
 * with one), and the screen-reader text form (it labels the drawer's hidden "go to comment" button, which the local
 * panel does not have).
 */
import { Fragment, type ReactNode } from 'react';

export const COMMENT_MARKDOWN = true;

/** Only text with one of these goes through the parser; the rest renders as it is. */
const DETECT = /[\u0060*_~]|^[ \t]*(?:>|#{2,6}[ \t]|-[ \t]|\d{1,3}[.)][ \t])/m;
/** The backtick, written so (here and in the regexes) to keep build-css.mjs's template-literal scan off this file. */
const TICK = '\u0060';
const MAX_LENGTH = 4096;
const MAX_DEPTH = 6;
const MAX_DELIMITERS = 400;
const MAX_BLOCKS = 200;

const RUN = 'rtl:[unicode-bidi:plaintext]';
const CODE = 'rounded bg-alpha-1 px-xs font-mono text-code [&&]:[word-break:normal]';
const PRE = 'm-0 rounded bg-neutral px-sm py-xs text-start font-mono text-code break-words whitespace-pre-wrap';
const QUOTE = 'm-0 border-s-4 ps-md italic';
const UL = 'm-0 list-disc ps-xl';
const OL = 'm-0 list-decimal ps-[2.5em]';

type Inline =
  | string
  | { t: 'raw'; raw: string }
  | { t: 'code'; text: string }
  | { t: 'em' | 'strong' | 'del'; c: Inline[]; depth: number };

type ListItem = { n: number; c: Block[] };

type Block =
  | { t: 'blank' }
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; c: Inline[] }
  | { t: 'code'; text: string; info: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; items: ListItem[] };

type Parsed = { blocks: Block[]; endsWithNewline: boolean };

/** A comment's text as React children: Markdown when it has any, else the text itself. flat: a panel row. */
export function commentMarkdown(text: string, { flat = false }: { flat?: boolean } = {}): ReactNode {
  if (!COMMENT_MARKDOWN || text.length > MAX_LENGTH || !DETECT.test(text)) return text;
  const { blocks, endsWithNewline } = parse(text);
  const out = renderBlocks(blocks, flat, 'b', 0);
  const last = blocks[blocks.length - 1];
  if (endsWithNewline && (last?.t === 'p' || last?.t === 'h')) out.push('\n');
  return out;
}

// ---------- blocks ----------

const cache = new Map<string, Parsed>();
const CACHE_SIZE = 1200;

function parse(text: string): Parsed {
  const hit = cache.get(text);
  if (hit) {
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const lines = text.replaceAll(/\r\n?/g, '\n').split('\n');
  const endsWithNewline = lines.length > 1 && lines[lines.length - 1] === '';
  if (endsWithNewline) lines.pop();
  const parsed: Parsed = { blocks: parseBlocks(lines, 0, false, { blocks: MAX_BLOCKS }), endsWithNewline };
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value ?? '');
  cache.set(text, parsed);
  return parsed;
}

const FENCE_OPEN = /^ {0,3}(\u0060{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(\u0060+|~+)[ \t]*$/;
const QUOTE_LINE = /^ {0,3}>(?: |$)/;
const HEADING = /^ {0,3}#{2,6}[ \t]/;
const RULE = /^ {0,3}([-*])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^( *)([-*]|(\d{1,3})([.)]))( +)(\S.*)$/;
const isBlank = (line: string) => /^[ \t]*$/.test(line);
const indentOf = (line: string) => /^ */.exec(line)?.[0].length ?? 0;
const expandTabs = (line: string) => line.replace(/^[ \t]+/, lead => lead.replaceAll('\t', '    '));

/** Spaces and tabs off both ends (not other white space). */
function trim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (text[start] === ' ' || text[start] === '\t')) start++;
  while (end > start && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  return text.slice(start, end);
}

function fenceOpen(line: string) {
  const m = FENCE_OPEN.exec(line);
  if (!m) return undefined;
  const [, fence = '', rest = ''] = m;
  if (fence[0] === TICK && rest.includes(TICK)) return undefined;
  return { ch: fence[0] ?? TICK, n: fence.length, info: trim(rest) };
}

/** The line that closes the fence opened at line at, or -1. An unclosed fence shuts out shorter ones after it. */
function fenceEnd(lines: string[], at: number, unclosed: Record<string, number>): number {
  const open = fenceOpen(lines[at] ?? '');
  if (!open || open.n >= (unclosed[open.ch] ?? Infinity)) return -1;
  for (let i = at + 1; i < lines.length; i++) {
    const fence = FENCE_CLOSE.exec(lines[i] ?? '')?.[1];
    if (fence && fence[0] === open.ch && fence.length >= open.n) return i;
  }
  unclosed[open.ch] = open.n;
  return -1;
}

function heading(line: string): string | undefined {
  const m = HEADING.exec(line);
  if (!m) return undefined;
  const rest = trim(line.slice(m[0].length));
  let end = rest.length;
  while (end > 0 && rest[end - 1] === '#') end--;
  const text = end < rest.length && (end === 0 || /[ \t]/.test(rest[end - 1] ?? '')) ? trim(rest.slice(0, end)) : rest;
  return text === '' ? undefined : text;
}

type Item = { indent: number; content: number; ordered: boolean; kind: string; n: number; rest: string };

/** A list item's first line. After a paragraph only "1." (or a bullet) starts a list. */
function listItem(line: string, afterParagraph: boolean): Item | undefined {
  if (RULE.test(line)) return undefined;
  const m = ITEM.exec(line);
  if (!m) return undefined;
  const [, lead = '', marker = '', number, delimiter = '', gap = '', rest = ''] = m;
  const ordered = number !== undefined;
  const n = ordered ? Number(number) : 1;
  if (ordered && afterParagraph && n !== 1) return undefined;
  const pad = gap.length > 4 ? 1 : gap.length;
  return {
    indent: lead.length,
    content: lead.length + marker.length + pad,
    ordered,
    kind: ordered ? delimiter : marker,
    n,
    rest: ' '.repeat(gap.length - pad) + rest,
  };
}

const startsBlock = (lines: string[], at: number, unclosed: Record<string, number>) => {
  const line = lines[at] ?? '';
  return fenceEnd(lines, at, unclosed) >= 0 || QUOTE_LINE.test(line) || heading(line) !== undefined || listItem(line, true) !== undefined;
};

function parseBlocks(raw: string[], depth: number, inItem: boolean, budget: { blocks: number }): Block[] {
  if (depth >= MAX_DEPTH) {
    budget.blocks--;
    return [{ t: 'p', c: inline(raw.join('\n')) }];
  }
  const lines = raw.map(expandTabs);
  const unclosed: Record<string, number> = {};
  const out: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    if (budget.blocks <= 0) {
      out.push({ t: 'p', c: [{ t: 'raw', raw: raw.slice(at).join('\n') }] });
      break;
    }
    budget.blocks--;
    const line = lines[at] ?? '';
    if (isBlank(line)) {
      out.push({ t: 'blank' });
      at++;
      continue;
    }
    const end = fenceEnd(lines, at, unclosed);
    if (end >= 0) {
      const indent = indentOf(line);
      const body = indent === 0 ? raw.slice(at + 1, end) : lines.slice(at + 1, end).map(l => l.slice(Math.min(indent, indentOf(l))));
      out.push({ t: 'code', text: body.join('\n'), info: fenceOpen(line)?.info ?? '' });
      at = end + 1;
      continue;
    }
    // The first line of a list item is the item's own text, never a quote, heading or nested list.
    const blockStart = !(inItem && at === 0);
    if (blockStart && QUOTE_LINE.test(line)) {
      let stop = at;
      while (stop < lines.length && QUOTE_LINE.test(lines[stop] ?? '')) stop++;
      const inner = lines.slice(at, stop).map(l => l.replace(/^ {0,3}> ?/, ''));
      out.push(
        inner.every(isBlank) ? { t: 'p', c: inline(raw.slice(at, stop).join('\n')) } : { t: 'quote', c: parseBlocks(inner, depth + 1, false, budget) },
      );
      at = stop;
      continue;
    }
    const title = blockStart ? heading(line) : undefined;
    if (title !== undefined) {
      out.push({ t: 'h', c: inline(title) });
      at++;
      continue;
    }
    const first = blockStart ? listItem(line, out[out.length - 1]?.t === 'p') : undefined;
    if (first) {
      const items: ListItem[] = [];
      let item: Item | undefined = first;
      while (item !== undefined && (items.length === 0 || budget.blocks > 0)) {
        const current: Item = item;
        const continuation = Math.min(current.content, current.indent + 2);
        const body = [current.rest];
        let next: Item | undefined;
        for (at++; at < lines.length; ) {
          let ahead = at;
          while (ahead < lines.length && isBlank(lines[ahead] ?? '')) ahead++;
          if (ahead === lines.length) break;
          if (indentOf(lines[ahead] ?? '') >= continuation) {
            for (; at <= ahead; at++) {
              const l = lines[at] ?? '';
              body.push(l.slice(Math.min(current.content, indentOf(l))));
            }
            continue;
          }
          const sibling = listItem(lines[ahead] ?? '', false);
          if (sibling !== undefined && sibling.ordered === first.ordered && sibling.kind === current.kind && sibling.indent >= current.indent) {
            for (; at < ahead; at++) body.push('');
            next = sibling;
          }
          break;
        }
        items.push({ n: current.n, c: parseBlocks(body, depth + 1, true, budget) });
        item = next;
      }
      out.push({ t: 'list', ordered: first.ordered, items });
      continue;
    }
    const paragraph = [raw[at] ?? ''];
    for (at++; at < lines.length && !isBlank(lines[at] ?? '') && !startsBlock(lines, at, unclosed); at++) paragraph.push(raw[at] ?? '');
    out.push({ t: 'p', c: inline(paragraph.join('\n')) });
  }
  return out;
}

// ---------- inline ----------

const WORD = /[\p{L}\p{N}]/u;
const isSpace = (c: string | undefined) => c === undefined || /\s/u.test(c);
const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}　-〿＀-￯]/u;
const QUOTE_MARK = /["']/;
/** Punctuation, symbols and emoji (with their variation selector and keycap). */
const isSymbol = (c: string | undefined) => c !== undefined && c > '' && (!/[\p{L}\p{M}\p{N}]/u.test(c) || c === '️' || c === '⃣');
const opensAfter = (c: string | undefined) => isSpace(c) || /[([{"'*_~]/.test(c ?? '') || isSymbol(c);
const closesBefore = (c: string | undefined) => isSpace(c) || /[)\]}"'.,;:!?%*_~]/.test(c ?? '') || isSymbol(c);

/** Whether a run of n ch between before and after can open or close emphasis. */
function flanks(ch: string, n: number, before: string | undefined, after: string | undefined, afterNext: string | undefined) {
  const letter = /[\p{L}\p{M}\p{N}]/u;
  if (ch === '_' && letter.test(before ?? ' ') && letter.test(after ?? ' ')) return { open: false, close: false };
  const cjk = CJK.test(before ?? ' ') || CJK.test(after ?? ' ');
  const quoted = n === 1 && QUOTE_MARK.test(before ?? ' ') && QUOTE_MARK.test(after ?? ' ');
  const dotted = after === '.' && WORD.test(afterNext ?? ' ');
  const beforeCloser = /[)\]}]/.test(after ?? ' ') || (n === 1 && after === '/');
  const afterOpener = /[([{]/.test(before ?? ' ') || (n === 1 && before === '/');
  return {
    open: !isSpace(after) && !quoted && !beforeCloser && !(n === 1 && dotted) && (cjk || opensAfter(before)),
    close: !isSpace(before) && !quoted && !afterOpener && !dotted && (cjk || closesBefore(after)),
  };
}

const URL_TEXT = /(?:[a-z][a-z0-9+.-]{0,31}:\/\/|www\.)[^\s<]+/giu;
const LINK =
  /!?\[[^\]\n]{0,300}\]\((?:<[^>\n]{0,1000}>|[^\s()]{1,1000}(?:\([^\s()]{0,200}\)[^\s()]{0,200}){0,8})(?:[ \t]+"[^"\n]{0,300}")?\)/g;

/** A bare URL without the punctuation that ends the sentence around it (and unmatched closing parentheses). */
function trimUrl(url: string): string {
  let unbalanced = url.split(')').length - url.split('(').length;
  let end = url.length;
  for (;;) {
    const c = url[end - 1];
    if (end > 0 && /[?!.,:;*_~'"]/.test(c ?? '')) end--;
    else if (c === ')' && unbalanced > 0) {
      end--;
      unbalanced--;
    } else return url.slice(0, end);
  }
}

/** Start → end of every Markdown link and bare URL: no emphasis or code starts inside them. */
function linkRanges(text: string): Map<number, number> {
  const ranges = new Map<number, number>();
  for (const m of text.matchAll(LINK)) ranges.set(m.index, m.index + m[0].length);
  for (const m of text.matchAll(URL_TEXT)) {
    if (m.index !== 0 && /[A-Za-z0-9]/.test(text[m.index - 1] ?? '')) continue;
    ranges.set(m.index, Math.max(m.index + trimUrl(m[0]).length, ranges.get(m.index) ?? 0));
  }
  return ranges;
}

type Delimiter = { t: 'delim'; ch: string; n: number; orig: number; open: boolean; close: boolean };
type Refused = { t: 'refused'; ch: string; text: string };
type Token = Inline | Delimiter | Refused;

function inline(text: string): Inline[] {
  const links = linkRanges(text);
  const out: Token[] = [];
  const escaped: Record<string, number> = { '*': 0, _: 0, '~': 0, [TICK]: 0 };
  let guarded = 0;
  let delimiters = 0;
  let run = '';
  const flush = () => {
    if (run !== '') out.push(run);
    run = '';
  };
  const runLength = (at: number) => {
    let n = 1;
    while (text[at + n] === text[at]) n++;
    return n;
  };
  const closingTicks = (from: number, n: number) => {
    for (let i = from + n; i < text.length; i++) {
      if (text[i] !== TICK) continue;
      const length = runLength(i);
      if (length === n) return i;
      i += length;
    }
    return -1;
  };
  const delimiter = (ch: string, n: number, before: string | undefined, after: number) => {
    if ((ch === '_' && n !== 1) || (ch === '~' && n !== 2)) return undefined;
    const f = flanks(ch, n, before, text[after], text[after + 1]);
    return f.open || f.close ? f : undefined;
  };
  let at = 0;
  while (at < text.length) {
    guarded = Math.max(guarded, links.get(at) ?? 0);
    const ch = text[at] ?? '';
    if (at < guarded) {
      run += ch;
      at++;
      continue;
    }
    const next = text[at + 1];
    if (ch === '\\' && (next === TICK || next === '*' || next === '_' || next === '~')) {
      // An escaped run loses its backslashes only where it would otherwise have opened (or closed) emphasis.
      let end = at;
      while (text[end] === '\\' && text[end + 1] === next) end += 2;
      const n = next === TICK ? runLength(at + 1) : (end - at) / 2;
      const stop = next === TICK ? at + 1 + n : end;
      const f = next === TICK ? { open: closingTicks(at + 1, n) >= 0, close: true } : delimiter(next, n, text[at - 1], end);
      const opens = f?.open === true && WORD.test(text[stop] ?? ' ');
      if (opens || (f?.close === true && (escaped[next] ?? 0) > 0)) {
        escaped[next] = (escaped[next] ?? 0) + (opens ? 1 : -1);
        run += next.repeat(n);
      } else run += text.slice(at, stop);
      at = stop;
      continue;
    }
    if (ch === TICK) {
      const n = runLength(at);
      const close = closingTicks(at, n);
      if (close < 0) {
        run += text.slice(at, at + n);
        at += n;
        continue;
      }
      let code = text.slice(at + n, close);
      if (code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1);
      flush();
      out.push({ t: 'code', text: code });
      at = close + n;
      continue;
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const n = runLength(at);
      const f = delimiters < MAX_DELIMITERS ? delimiter(ch, n, text[at - 1], at + n) : undefined;
      flush();
      if (f) {
        out.push({ t: 'delim', ch, n, orig: n, ...f });
        delimiters++;
      } else if (ch === '~') run += text.slice(at, at + n);
      else out.push({ t: 'refused', ch, text: text.slice(at, at + n) });
      at += n;
      continue;
    }
    run += ch;
    at++;
  }
  flush();
  return resolve(out);
}

const isDelimiter = (t: Token): t is Delimiter => typeof t === 'object' && t.t === 'delim';
const literal = (t: Token): Inline => (isDelimiter(t) ? t.ch.repeat(t.n) : typeof t === 'object' && t.t === 'refused' ? t.text : t);
const depthOf = (nodes: Inline[]) => Math.max(0, ...nodes.map(t => (typeof t === 'object' && 'depth' in t ? t.depth : 0)));
const hasText = (nodes: Inline[]) => nodes.some(t => typeof t !== 'string' || /[\p{L}\p{N}\u0080-\u{10FFFF}]/u.test(t));

/** Pairs delimiter runs into em / strong / del, CommonMark's way (the rule of three included); the rest is text. */
function resolve(tokens: Token[]): Inline[] {
  let list = tokens;
  let at = 0;
  while (at < list.length) {
    const closer = list[at];
    if (closer === undefined || !isDelimiter(closer) || !closer.close) {
      at++;
      continue;
    }
    let opener = -1;
    for (let i = at - 1; i >= 0; i--) {
      const t = list[i];
      if (t === undefined) continue;
      if (typeof t === 'object' && t.t === 'refused' && t.ch === closer.ch) break;
      if (
        isDelimiter(t) &&
        t.ch === closer.ch &&
        t.open &&
        !(closer.ch !== '~' && (t.close || closer.open) && (t.orig + closer.orig) % 3 === 0 && (t.orig % 3 !== 0 || closer.orig % 3 !== 0))
      ) {
        opener = i;
        break;
      }
    }
    const inner = opener < 0 ? [] : list.slice(opener + 1, at).map(literal);
    const depth = depthOf(inner) + 1;
    const openToken = opener < 0 ? undefined : list[opener];
    if (openToken !== undefined && !hasText(inner)) list[opener] = literal(openToken);
    if (openToken === undefined || !isDelimiter(openToken) || depth > MAX_DEPTH || !hasText(inner)) {
      if (!closer.open || opener >= 0) list[at] = literal(closer);
      at++;
      continue;
    }
    const used = closer.ch === '~' || (openToken.n >= 2 && closer.n >= 2) ? 2 : 1;
    const node: Inline = { t: closer.ch === '~' ? 'del' : used === 2 ? 'strong' : 'em', c: inner, depth };
    openToken.n -= used;
    closer.n -= used;
    const head = list.slice(0, openToken.n > 0 ? opener + 1 : opener);
    list = [...head, node, ...list.slice(closer.n > 0 ? at : at + 1)];
    at = head.length + 1;
  }
  return list.map(literal);
}

// ---------- rendering ----------

/**
 * Text blocks run together as text (the card keeps white space), each run after a block element in its own
 * plaintext-bidi span; flat mode makes every block a run.
 */
function renderBlocks(blocks: Block[], flat: boolean, key: string, level: number): ReactNode[] {
  const out: ReactNode[] = [];
  const isRun = (b: Block | undefined) => b !== undefined && (flat || b.t === 'p' || b.t === 'h' || b.t === 'blank');
  let run: ReactNode[] = out;
  const endRun = (k: string) => {
    if (run === out) return;
    out.push(
      <span key={k} className={RUN}>
        {run}
      </span>,
    );
    run = out;
  };
  blocks.forEach((block, i) => {
    const k = key + '.' + i;
    const newline = isRun(blocks.at(i + 1)) ? '\n' : '';
    if (!isRun(block)) endRun(k + 'r');
    else if (!flat && i > 0 && !isRun(blocks.at(i - 1))) run = [];
    switch (block.t) {
      case 'blank':
        run.push('\n');
        break;
      case 'p':
        run.push(...renderInline(block.c, k), newline);
        break;
      case 'h':
        run.push(
          <strong key={k} className="font-semibold">
            {renderInline(block.c, k)}
          </strong>,
          newline,
        );
        break;
      case 'code': {
        const info = block.info === '' ? null : <span className="block text-caption text-muted">{block.info}{'\n'}</span>;
        run.push(
          flat ? (
            <Fragment key={k}>
              {info && <span className="text-muted">{block.info} </span>}
              <code dir="ltr" className={CODE}>
                {block.text}
              </code>
            </Fragment>
          ) : (
            <pre key={k} dir="ltr" className={PRE}>
              {info}
              <code className="[&&]:[word-break:normal]">{block.text}</code>
            </pre>
          ),
          flat ? newline : '',
        );
        break;
      }
      case 'quote':
        run.push(
          flat ? (
            <span key={k} className="italic">
              {renderBlocks(block.c, flat, k, level)}
            </span>
          ) : (
            <blockquote key={k} className={QUOTE}>
              <span className={RUN}>{renderBlocks(block.c, flat, k, level)}</span>
            </blockquote>
          ),
          flat ? newline : '',
        );
        break;
      case 'list': {
        if (flat) {
          block.items.forEach((item, j) => {
            run.push('  '.repeat(level) + (block.ordered ? item.n + '. ' : '• '), ...renderBlocks(item.c, flat, k + '.' + j, level + 1));
            if (item.c.at(-1)?.t !== 'blank') run.push(j < block.items.length - 1 ? '\n' : newline);
          });
          break;
        }
        const items = block.items.map((item, j) => (
          <li key={j} value={block.ordered ? item.n : undefined}>
            <span className={RUN}>{renderBlocks(item.c, flat, k + '.' + j, level + 1)}</span>
          </li>
        ));
        run.push(
          block.ordered ? (
            <ol key={k} className={OL}>
              {items}
            </ol>
          ) : (
            <ul key={k} className={UL}>
              {items}
            </ul>
          ),
        );
        break;
      }
    }
  });
  endRun(key + '.end');
  return out;
}

function renderInline(nodes: Inline[], key: string): ReactNode[] {
  return nodes.map((node, i) => {
    if (typeof node === 'string') return node;
    const k = key + ':' + i;
    switch (node.t) {
      case 'raw':
        return <Fragment key={k}>{node.raw}</Fragment>;
      case 'code':
        return (
          <code key={k} dir="ltr" className={CODE}>
            {node.text}
          </code>
        );
      case 'em':
        return <em key={k}>{renderInline(node.c, k)}</em>;
      case 'strong':
        return (
          <strong key={k} className="font-semibold">
            {renderInline(node.c, k)}
          </strong>
        );
      case 'del':
        return <del key={k}>{renderInline(node.c, k)}</del>;
    }
  });
}
