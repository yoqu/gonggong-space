/**
 * Reads a component's props from its `<Comp>.d.ts`, for the Props panel and
 * the agent's component cards.
 *
 * This is a reader for the declarations agents write (one props interface
 * or type literal with JSDoc comments), not a TypeScript parser: anything it
 * cannot follow is shown as the raw declaration text.
 */

/** One prop. */
export interface PropInfo {
  name: string;
  /** The declared type, as written. */
  type: string;
  optional: boolean;
  /** The JSDoc description. */
  doc?: string;
  /** The `@default` tag. */
  defaultValue?: string;
}

/** Splits a declaration body into members, respecting nested braces, brackets and parens. */
function splitMembers(body: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '{' || c === '(' || c === '[' || c === '<') depth++;
    else if (c === '}' || c === ')' || c === ']' || (c === '>' && body[i - 1] !== '=')) depth--;
    else if ((c === ';' || c === '\n' || c === ',') && depth === 0) {
      members.push(body.slice(start, i));
      start = i + 1;
    }
  }
  members.push(body.slice(start));
  // A line that continues a type (`| 'b'`, `& Extra`) belongs to the member before it.
  const merged: string[] = [];
  for (const member of members) {
    if (merged.length && /^\s*[|&]/.test(member)) merged[merged.length - 1] += `\n${member}`;
    else merged.push(member);
  }
  return merged;
}

/** The body between the brace at `open` and its match. */
function braced(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/** Cleans a JSDoc block into its description and tags. */
function readDoc(comment: string): { doc?: string; defaultValue?: string } {
  const lines = comment
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd());
  const out: { doc?: string; defaultValue?: string } = {};
  const text: string[] = [];
  for (const line of lines) {
    // `@default x` may start a line or follow the description on it.
    const tag = /(^|\s)@default(?:Value)?\s+(.+)$/.exec(line);
    if (tag) out.defaultValue = tag[2]!.trim();
    const rest = tag ? line.slice(0, tag.index) : line;
    if (!rest.trim().startsWith('@')) text.push(rest);
  }
  const doc = text.join(' ').replace(/\s+/g, ' ').trim();
  if (doc) out.doc = doc;
  return out;
}

/**
 * Finds the props declaration of `component`: `<Comp>Props` first, else
 * the first exported interface, else the first parameter type literal of
 * the component's function declaration. Returns `null` when none is found.
 */
export function readProps(dts: string, component: string, options: { shared?: boolean } = {}): PropInfo[] | null {
  const patterns = [
    new RegExp(`(?:interface|type)\\s+${component}Props\\b[^{=]*=?\\s*{`),
    // A shared `index.d.ts` declares every component: only a named match counts there.
    ...(options.shared ? [] : [/export\s+interface\s+\w+[^{]*{/]),
    new RegExp(`function\\s+${component}\\s*\\(\\s*\\w*\\s*:\\s*{`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(dts);
    if (!match) continue;
    const body = braced(dts, match.index + match[0].length - 1);
    if (body !== null) return parseMembers(body);
  }
  return null;
}

/** Parses interface members with their JSDoc comments. */
function parseMembers(body: string): PropInfo[] {
  const props: PropInfo[] = [];
  // Attach each `/** … */` to the member that follows it.
  const docs: { end: number; comment: string }[] = [];
  for (const match of body.matchAll(/\/\*\*[\s\S]*?\*\//g)) docs.push({ end: match.index + match[0].length, comment: match[0] });
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length)).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  let offset = 0;
  for (const member of splitMembers(stripped)) {
    const at = offset;
    offset += member.length + 1;
    const match = /^\s*(readonly\s+)?(["']?)([A-Za-z_$][\w$-]*)\2(\?)?\s*:\s*([\s\S]+?)\s*$/.exec(member);
    if (!match) continue;
    const prop: PropInfo = { name: match[3]!, type: match[5]!.replace(/\s+/g, ' '), optional: Boolean(match[4]) };
    const lead = member.length - member.trimStart().length;
    const doc = docs.filter((d) => d.end <= at + lead).pop();
    // Only the comment directly before this member (nothing but space between).
    if (doc && !stripped.slice(doc.end, at + lead).trim()) Object.assign(prop, readDoc(doc.comment));
    props.push(prop);
  }
  return props;
}

/** Where a component's props come from: its own `<Comp>.d.ts`, else the shared `components/index.d.ts`. */
export interface ComponentProps {
  /** The declaration file read. */
  path: string;
  /** Its text. */
  dts: string;
  /** The props, or null when the declaration could not be followed. */
  props: PropInfo[] | null;
}

/** Reads a component's props from its own declaration or the shared one. */
export function componentProps(read: (path: string) => string | undefined, component: string): ComponentProps | null {
  const own = `components/${component}/${component}.d.ts`;
  const dts = read(own);
  if (typeof dts === 'string') return { path: own, dts, props: readProps(dts, component) };
  const index = read('components/index.d.ts');
  if (typeof index !== 'string') return null;
  const props = readProps(index, component, { shared: true });
  return props ? { path: 'components/index.d.ts', dts: index, props } : null;
}
