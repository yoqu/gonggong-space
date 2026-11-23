/**
 * The `.dc.html` file as a whole: where the template, the logic script and
 * its `data-props` live in the source, and how to replace one of them while
 * every other byte of the file stays as written.
 */

import { decodeEntities } from './html.ts';
import { parseProps, type PropsSpec } from './props.ts';

/** The line every artboard's `<head>` must carry; the editor swaps it for the runtime. */
export const SUPPORT_SCRIPT_TAG = '<script src="./support.js"></script>';

/** Finds the runtime tag in the head. Nested boards can address the project root. */
export function supportScriptTag(source: string): string | null {
  const head = /<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i.exec(source)?.[1];
  return head?.match(/<script src="(?:\.\/|(?:\.\.\/)+)support\.js"><\/script>/)?.[0] ?? null;
}

/** A range of the source. */
export interface SourceRange {
  start: number;
  end: number;
}

/** A parsed `.dc.html` source. All offsets index into `source`. */
export interface DcDocument {
  source: string;
  /** The text strictly between `<x-dc …>` and the LAST `</x-dc>`; `null` when missing. */
  template: (SourceRange & { text: string }) | null;
  /** The `<script type="text/x-dc" data-dc-script>` element, if any. */
  script:
    | (SourceRange & {
        /** The script body (classic JS). */
        body: SourceRange & { text: string };
        /** The `data-props` attribute's full `data-props='…'` text, if present. */
        propsAttr: (SourceRange & { raw: string }) | null;
      })
    | null;
  /** Parsed `data-props`, or `null` when absent. */
  props: PropsSpec | null;
  /** Why `data-props` could not be parsed. */
  propsError: string | null;
  /** `<title>` text, decoded. */
  title: string | null;
  /** `<html lang>` value. */
  lang: string | null;
  /** The head carries {@link SUPPORT_SCRIPT_TAG} exactly. */
  hasSupportScript: boolean;
  /** The `<head>` inner text (between `<head>` and `</head>`), for importers and exports. */
  head: (SourceRange & { text: string }) | null;
}

/** Finds the `<x-dc>` open tag and the last `</x-dc>`. */
function findTemplate(source: string): DcDocument['template'] {
  const open = /<x-dc(\s[^>]*)?>/i.exec(source);
  if (!open) return null;
  const start = open.index + open[0].length;
  const end = source.toLowerCase().lastIndexOf('</x-dc>');
  if (end < start) return null;
  return { start, end, text: source.slice(start, end) };
}

/** Finds the logic script after the template. */
function findScript(source: string, after: number): DcDocument['script'] {
  const re = /<script\b([^>]*)>/gi;
  re.lastIndex = after;
  for (let match = re.exec(source); match; match = re.exec(source)) {
    const attrs = match[1] ?? '';
    if (!/\bdata-dc-script\b/i.test(attrs) && !/type\s*=\s*["']text\/x-dc["']/i.test(attrs)) continue;
    const bodyStart = match.index + match[0].length;
    const close = source.toLowerCase().indexOf('</script>', bodyStart);
    const bodyEnd = close === -1 ? source.length : close;
    const end = close === -1 ? source.length : close + '</script>'.length;

    let propsAttr: (SourceRange & { raw: string }) | null = null;
    const propsMatch = /\sdata-props\s*=\s*('[^']*'|"[^"]*")/i.exec(attrs);
    if (propsMatch) {
      // Offsets of `data-props='…'` inside the start tag (skip the leading space).
      const attrOffset = match.index + '<script'.length + propsMatch.index + 1;
      const raw = propsMatch[0].slice(1);
      propsAttr = { start: attrOffset, end: attrOffset + raw.length, raw };
    }
    return {
      start: match.index,
      end,
      body: { start: bodyStart, end: bodyEnd, text: source.slice(bodyStart, bodyEnd) },
      propsAttr,
    };
  }
  return null;
}

/** Parses a `.dc.html` source. Never throws; problems surface as `null` fields. */
export function parseDcDocument(source: string): DcDocument {
  const template = findTemplate(source);
  const script = findScript(source, template ? template.end : 0);

  let props: PropsSpec | null = null;
  let propsError: string | null = null;
  if (script?.propsAttr) {
    const quoted = script.propsAttr.raw.slice(script.propsAttr.raw.indexOf('=') + 1).trim();
    const json = decodeEntities(quoted.slice(1, -1));
    const parsed = parseProps(json);
    if (parsed.ok) props = parsed.props;
    else propsError = parsed.error;
  }

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(template ? source.slice(0, template.start) : source);
  const langMatch = /<html\b[^>]*\blang\s*=\s*["']([^"']*)["']/i.exec(source);
  const headOpen = /<head(\s[^>]*)?>/i.exec(source);
  const headClose = source.toLowerCase().indexOf('</head>');
  const head =
    headOpen && headClose > headOpen.index
      ? {
          start: headOpen.index + headOpen[0].length,
          end: headClose,
          text: source.slice(headOpen.index + headOpen[0].length, headClose),
        }
      : null;

  return {
    source,
    template,
    script,
    props,
    propsError,
    title: titleMatch ? decodeEntities(titleMatch[1]!.trim()) : null,
    lang: langMatch ? langMatch[1]! : null,
    hasSupportScript: supportScriptTag(source) !== null,
    head,
  };
}

/** Replaces the template text; everything outside `<x-dc>` stays byte-identical. */
export function replaceTemplate(doc: DcDocument, template: string): string {
  if (!doc.template) throw new Error('The file has no <x-dc> template to replace.');
  return doc.source.slice(0, doc.template.start) + template + doc.source.slice(doc.template.end);
}

/** Replaces the logic script's body. */
export function replaceScriptBody(doc: DcDocument, body: string): string {
  if (!doc.script) throw new Error('The file has no data-dc-script block.');
  return doc.source.slice(0, doc.script.body.start) + body + doc.source.slice(doc.script.body.end);
}

/**
 * Encodes JSON for a single-quoted `data-props` attribute: `&` → `&amp;`,
 * `'` → `&#39;`. Raw UTF-8 and double quotes stay as they are.
 */
export function encodePropsAttribute(json: string): string {
  return `data-props='${json.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}'`;
}

/** Writes (or adds) the `data-props` attribute with a new spec. */
export function replaceProps(doc: DcDocument, props: PropsSpec): string {
  if (!doc.script) throw new Error('The file has no data-dc-script block.');
  const attribute = encodePropsAttribute(JSON.stringify(props));
  if (doc.script.propsAttr) {
    return doc.source.slice(0, doc.script.propsAttr.start) + attribute + doc.source.slice(doc.script.propsAttr.end);
  }
  // Insert right before the start tag's closing `>`.
  const close = doc.source.indexOf('>', doc.script.start);
  return `${doc.source.slice(0, close)} ${attribute}${doc.source.slice(close)}`;
}

/** Base name of a path: `sub/Main.dc.html` → `Main.dc.html`. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The stem of an artboard file: `sub/Main.dc.html` → `Main`. */
export function boardStem(path: string): string {
  return baseName(path).replace(/\.dc\.html$/i, '');
}
