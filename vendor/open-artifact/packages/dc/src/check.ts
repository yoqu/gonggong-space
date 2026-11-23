/**
 * Static checks of one `.dc.html` file: the rules an author (usually an
 * agent) must follow for the editor to load, edit and save it faithfully.
 * Errors break the artboard; warnings degrade it.
 */

import { SUPPORT_SCRIPT_TAG, parseDcDocument } from './document.ts';
import { VOID_ELEMENTS, attributeValue, type HtmlElement } from './html.ts';
import { splitHoles, wholeHole } from './holes.ts';
import { parseTemplate } from './template.ts';

/** One finding. */
export interface Diagnostic {
  level: 'error' | 'warning';
  message: string;
  /** 1-based line in the file, when known. */
  line?: number;
}

/** Path rule for artboard files: segments start with a letter, digit or `_`. */
export const BOARD_PATH_PATTERN = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*\.dc\.html$/;

/** True when `path` is a valid artboard path. */
export function isBoardPath(path: string): boolean {
  return BOARD_PATH_PATTERN.test(path) && !path.split('/').some((part) => part === '.' || part === '..');
}

/** Hosts a page may load from: Google Fonts stylesheets and font files. */
const ALLOWED_REMOTE = [/^https:\/\/fonts\.googleapis\.com\/css2\?/i, /^https:\/\/fonts\.gstatic\.com\//i];
/** Elements that embed other documents; never allowed. */
const EMBEDS = new Set(['iframe', 'object', 'embed', 'frame', 'frameset', 'portal']);
/** Attributes that load something. */
const URL_ATTRIBUTES = ['src', 'href', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href'];

/** Options of {@link checkDcFile}. */
export interface CheckOptions {
  /** Every project file path, to verify `<dc-import>` targets and links. */
  files?: ReadonlySet<string>;
  /** The board's size in `canvas.json` (`w`, `h`), to compare with `$preview`. */
  board?: { w: number; h: number };
  /** Whether an upload exists (`/_blob/<id>`, 32 hex); without it uploads are not checked. */
  blobExists?: (id: string) => boolean;
}

/** An upload id. */
const BLOB_ID_PATTERN = /^[0-9a-f]{32}$/;
/** `/_blob/<id>`, and a design system's `../_blob/<id>`. */
const isBlobUrl = (url: string): boolean => /^(?:\.{1,2}\/)*\/?_blob\//.test(url.trim());
/** An address on another host (`https://…`, `//…`). */
const isRemote = (url: string): boolean => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url.trim());
const isGoogleFonts = (url: string): boolean => /^(?:https?:)?\/\/fonts\.googleapis\.com\//i.test(url.trim());

/** Checks a `.dc.html` file. */
export function checkDcFile(path: string, source: string, options: CheckOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lineAt = (offset: number): number => source.slice(0, offset).split('\n').length;

  if (!isBoardPath(path)) {
    out.push({ level: 'error', message: `"${path}" is not a valid artboard path: segments start with a letter, digit or _, then only letters, digits, _ . -, ending in .dc.html.` });
  }
  const doc = parseDcDocument(source);
  if (!doc.hasSupportScript) out.push({ level: 'error', message: `The <head> must contain exactly ${SUPPORT_SCRIPT_TAG}` });
  if (!doc.template) {
    out.push({ level: 'error', message: 'No <x-dc> … </x-dc> template.' });
    return out;
  }
  if (!doc.title) out.push({ level: 'warning', message: 'No <title>: give each artboard a short title.' });
  if (!doc.lang) out.push({ level: 'warning', message: 'No lang on <html>.' });
  if (doc.propsError) out.push({ level: 'error', message: doc.propsError, line: doc.script?.propsAttr ? lineAt(doc.script.propsAttr.start) : undefined });

  // Exactly one logic block, sized like its board.
  const logicBlocks = [...source.matchAll(/<script\b[^>]*\bdata-dc-script\b[^>]*>/gi)];
  if (!doc.script) {
    out.push({ level: 'error', message: 'Missing the <script type="text/x-dc" data-dc-script data-props=\'…\'> block (class Component extends DCLogic).' });
  } else if (logicBlocks.length > 1) {
    out.push({ level: 'error', message: `Has ${logicBlocks.length} data-dc-script blocks; an artboard has exactly one.`, line: lineAt(logicBlocks[1]!.index) });
  }
  const preview = doc.props?.$preview;
  if (doc.script && !doc.propsError && !preview) {
    out.push({ level: 'warning', message: 'data-props has no "$preview": {"width": …, "height": …}; give it the board\'s w and h.', line: lineAt(doc.script.start) });
  }
  if (preview && options.board && (preview.width !== options.board.w || preview.height !== options.board.h)) {
    out.push({
      level: 'error',
      message: `$preview is ${preview.width}×${preview.height} but canvas.json boards gives ${options.board.w}×${options.board.h}; make them equal.`,
      line: doc.script?.propsAttr ? lineAt(doc.script.propsAttr.start) : undefined,
    });
  }

  // Every inline script (the logic block and any other): no UI built from script, no globals, no keys, no network.
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = match[1] ?? '';
    const inTemplate = doc.template !== null && match.index > doc.template.start && match.index < doc.template.end;
    if (inTemplate) continue; // reported below: template scripts never run
    const src = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    if (src !== undefined) {
      checkHeadRef(path, src, '<script src>', options, lineAt(match.index), out);
      continue;
    }
    checkScriptCode(match[2] ?? '', lineAt(match.index), out);
  }
  // Stylesheets and preloads outside the template.
  for (const match of source.matchAll(/<link\b([^>]*)>/gi)) {
    const inTemplate = doc.template !== null && match.index > doc.template.start && match.index < doc.template.end;
    if (inTemplate) continue;
    const attrs = match[1] ?? '';
    const rel = (/\brel\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? '').toLowerCase().split(/\s+/);
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    if (href === undefined || !rel.some((r) => r === 'stylesheet' || r === 'preload' || r === 'modulepreload')) continue;
    checkHeadRef(path, href, '<link href>', options, lineAt(match.index), out);
  }
  // Uploads this artifact does not have.
  if (options.blobExists) {
    const reported = new Set<string>();
    for (const match of source.matchAll(/\/_blob\/([^\s"'()<>?#]*)/g)) {
      const id = match[1]!;
      if (reported.has(id)) continue;
      reported.add(id);
      if (!BLOB_ID_PATTERN.test(id)) {
        out.push({ level: 'error', message: `/_blob/${id} is not a valid upload reference: use the /_blob/<id> that upload printed (32 lowercase hex digits).`, line: lineAt(match.index) });
      } else if (!options.blobExists(id)) {
        out.push({ level: 'error', message: `/_blob/${id} is not an upload of this design: upload the file and use the /_blob/<id> it prints.`, line: lineAt(match.index) });
      }
    }
  }

  // Logic script.
  if (doc.script) {
    const body = doc.script.body.text;
    if (!/\bclass\s+Component\s+extends\s+DCLogic\b/.test(body)) {
      out.push({ level: 'error', message: 'The logic script must define `class Component extends DCLogic`.', line: lineAt(doc.script.start) });
    }
    if (/^\s*(import|export)\b/m.test(body)) {
      out.push({ level: 'error', message: 'The logic script is classic JavaScript: no import or export.', line: lineAt(doc.script.start) });
    }
    if (/\brender\s*\(\s*\)\s*\{/.test(body)) {
      out.push({ level: 'warning', message: 'Do not define render(); return values from renderVals() instead.', line: lineAt(doc.script.start) });
    }
  }

  const model = parseTemplate(doc.template.text);
  const base = doc.template.start;
  const at = (element: HtmlElement): number => lineAt(base + element.start);

  for (const element of model.elements) {
    const line = at(element);
    if (!VOID_ELEMENTS.has(element.tag) && !element.selfClosing && element.closeStart < 0) {
      out.push({ level: 'error', message: `<${element.rawTag}> is never closed.`, line });
    }
    if (EMBEDS.has(element.tag)) out.push({ level: 'error', message: `<${element.tag}> is not allowed in an artboard.`, line });
    if (/[A-Z]/.test(element.rawTag[0] ?? '') && !element.rawTag.includes('-')) {
      out.push({ level: 'error', message: `<${element.rawTag}>: capitalized component tags are not supported; use <dc-import name="${element.rawTag}"></dc-import>.`, line });
    }
    if (element.tag === 'script') out.push({ level: 'warning', message: 'Scripts inside the template never run; put logic in the data-dc-script block.', line });

    // Holes in attributes and text.
    for (const attr of element.attrs) {
      if (attr.value === null) continue;
      for (const part of splitHoles(attr.value)) {
        if (part.kind === 'hole' && part.hole.kind === 'invalid') {
          out.push({ level: 'error', message: `{{ ${part.hole.raw} }} is not a dotted path or literal; compute it in renderVals().`, line });
        }
      }
      const lower = attr.name.toLowerCase();
      if (/^on[a-z]/i.test(attr.name) && !wholeHole(attr.value)) {
        out.push({ level: 'error', message: `${attr.name}="…" must be a whole hole bound to a function, like onClick="{{ pick }}".`, line });
      }
      if (URL_ATTRIBUTES.includes(lower)) checkUrl(attr.value, element, line, out);
      if (lower === 'src' && (element.tag === 'img' || element.tag === 'source')) checkAssetUrl(path, attr.value, `<${element.tag} src>`, options, line, out);
      if (lower === 'style' && /url\(\s*['"]?https?:/i.test(attr.value)) {
        out.push({ level: 'error', message: 'Inline styles may not load remote URLs; upload the image and use /_blob/<id>.', line });
      }
    }
    for (const child of element.children) {
      if (child.type !== 'text' || element.tag === 'style' || element.tag === 'script') continue;
      for (const part of splitHoles(child.value)) {
        if (part.kind === 'hole' && part.hole.kind === 'invalid') {
          out.push({ level: 'error', message: `{{ ${part.hole.raw} }} is not a dotted path or literal; compute it in renderVals().`, line });
        }
      }
    }
    if (element.tag === 'style') {
      const css = element.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
      if (/@import\s+(url\()?\s*['"]?https?:/i.test(css) && !/fonts\.googleapis\.com\/css2/i.test(css)) {
        out.push({ level: 'error', message: 'Only Google Fonts css2 stylesheets may be imported.', line });
      }
      for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
        const url = match[1] ?? match[2] ?? match[3] ?? '';
        if (isGoogleFonts(url)) continue;
        checkAssetUrl(path, url, 'url(…)', options, line, out);
      }
    }

    // Structure tags.
    if (element.tag === 'sc-for') {
      const list = attributeValue(element, 'list');
      if (!list || !wholeHole(list)) out.push({ level: 'error', message: '<sc-for> needs list="{{ items }}".', line });
      if (!attributeValue(element, 'as')) out.push({ level: 'warning', message: '<sc-for> has no as="…"; the loop variable defaults to "item".', line });
      if (attributeValue(element, 'hint-placeholder-count') === undefined) {
        out.push({ level: 'warning', message: '<sc-for> should set hint-placeholder-count.', line });
      }
    }
    if (element.tag === 'sc-if') {
      if (attributeValue(element, 'value') === undefined) out.push({ level: 'error', message: '<sc-if> needs value="{{ cond }}".', line });
      if (attributeValue(element, 'hint-placeholder-val') === undefined) {
        out.push({ level: 'warning', message: '<sc-if> should set hint-placeholder-val.', line });
      }
    }
    if (element.tag === 'dc-import') {
      const name = attributeValue(element, 'name');
      if (!name) out.push({ level: 'error', message: '<dc-import> needs name="Sibling".', line });
      if (element.selfClosing) out.push({ level: 'error', message: '<dc-import> must not self-close; write <dc-import …></dc-import>.', line });
      if (name && options.files) {
        const target = `${path.slice(0, path.lastIndexOf('/') + 1)}${name}.dc.html`;
        if (!options.files.has(target)) out.push({ level: 'error', message: `<dc-import name="${name}">: ${target} does not exist.`, line });
      }
      if (attributeValue(element, 'hint-size') === undefined) out.push({ level: 'warning', message: '<dc-import> should set hint-size="W,H".', line });
    }
    if (element.tag === 'a' && options.files) {
      const href = attributeValue(element, 'href') ?? '';
      if (/\.dc\.html(#.*)?$/i.test(href) && !/^[a-z]+:/i.test(href)) {
        const target = href.replace(/#.*$/, '');
        const resolved = target.startsWith('/') ? target.slice(1) : resolveRelative(path, target);
        if (!options.files.has(resolved)) out.push({ level: 'warning', message: `Link to ${href}: ${resolved} does not exist.`, line });
      }
    }
  }
  return out;
}

/** Resolves a link relative to an artboard path. */
function resolveRelative(from: string, target: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** Network rule: only Google Fonts and uploaded blobs load. */
function checkUrl(value: string, element: HtmlElement, line: number, out: Diagnostic[]): void {
  const url = value.trim();
  if (!url || url.includes('{{')) return;
  if (element.tag === 'a') return; // Links navigate; they do not load.
  // Resource hints load nothing; the Google Fonts snippet starts with them.
  if (element.tag === 'link' && /^(preconnect|dns-prefetch)$/i.test(attributeValue(element, 'rel')?.trim() ?? '')) {
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\/?$/i.test(url)) return;
  }
  if (/^(data:|blob:|#)/i.test(url) || url.startsWith('/_blob/')) return;
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
    if (!ALLOWED_REMOTE.some((pattern) => pattern.test(url))) {
      out.push({ level: 'error', message: `${url.slice(0, 80)}: only Google Fonts and /_blob/<id> uploads may load; upload the file first.`, line });
    }
  }
}

/** Resolves a reference against an artboard path; `null` when it leaves the project. */
function resolveInProject(from: string, ref: string): string | null {
  const clean = ref.split(/[?#]/)[0]!;
  const parts = clean.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

/**
 * An image or `url(…)` address: an upload (`/_blob/<id>`), a `{{hole}}`, or a
 * file of the project. A `data:` URI, a `blob:` URL and a bare file name the
 * project does not have are reported.
 */
function checkAssetUrl(path: string, url: string, where: string, options: CheckOptions, line: number | undefined, out: Diagnostic[]): void {
  const value = url.trim();
  if (value === '' || value.startsWith('#') || value.includes('{{') || isBlobUrl(value)) return;
  if (/^data:/i.test(value)) {
    out.push({ level: 'warning', message: `${where} uses a data: URI; upload the file and use its /_blob/<id>.`, line });
  } else if (/^blob:/i.test(value)) {
    out.push({ level: 'error', message: `${where} uses a blob: URL, which only lives in one browser tab; upload the file and use its /_blob/<id>.`, line });
  } else if (isRemote(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    // Remote addresses are reported by the network rule (checkUrl) or allowed (Google Fonts files).
    return;
  } else if (options.files) {
    const target = resolveInProject(path, value);
    if (target === null || !options.files.has(target)) {
      out.push({ level: 'error', message: `${where} names the file ${value.slice(0, 80)}, which is not in this design; upload it and use the /_blob/<id> it prints.`, line });
    }
  }
}

/** A `<script src>` or `<link href>` outside the template: an upload, Google Fonts, or a file of the project. */
function checkHeadRef(path: string, ref: string, where: string, options: CheckOptions, line: number, out: Diagnostic[]): void {
  const value = ref.trim();
  if (!value || value === './support.js' || value.includes('{{') || isBlobUrl(value)) return;
  if (isRemote(value)) {
    if (!(where === '<link href>' && isGoogleFonts(value))) {
      out.push({ level: 'error', message: `${where}="${value.slice(0, 80)}" loads from the network; only Google Fonts and /_blob/<id> uploads may load. Upload the file instead.`, line });
    }
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    out.push({ level: 'error', message: `${where}="${value.slice(0, 80)}": use a file of this design or an uploaded /_blob/<id>.`, line });
    return;
  }
  if (!options.files) return;
  const target = resolveInProject(path, value);
  if (target === null || target === '' || !options.files.has(target)) {
    out.push({ level: 'error', message: `${where}="${value.slice(0, 80)}" is not a file in this design; write it there or upload it.`, line });
  }
}

/** Script rules: UI is markup, state stays in the component, no global keys, no network. */
function checkScriptCode(code: string, line: number, out: Diagnostic[]): void {
  if (/\.(?:inner|outer)HTML\s*=(?!=)|\binsertAdjacentHTML\s*\(|\.appendChild\s*\(|\bdocument\.write(?:ln)?\s*\(/.test(code)) {
    out.push({ level: 'error', message: 'Builds UI from script (innerHTML / appendChild / document.write); all UI is <x-dc> markup people can select and edit.', line });
  }
  if (/\bwindow\.[A-Za-z_$][\w$]*\s*=(?!=)/.test(code)) {
    out.push({ level: 'error', message: 'Sets a window.X global; keep state in the component (state / setState) and mount components with <dc-import> or a design system\'s x-import.', line });
  }
  if (/\b(?:window|document|globalThis)\s*\.\s*(?:addEventListener\s*\(\s*['"`]key(?:down|up|press)['"`]|onkey(?:down|up|press)\s*=)/.test(code)) {
    out.push({ level: 'error', message: 'Installs a global keyboard handler; artboards must not handle keys on window or document (the editor owns them).', line });
  }
  for (const match of code.matchAll(/\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    if (isRemote(match[1]!)) out.push({ level: 'error', message: `fetch("${match[1]!.slice(0, 80)}") goes to the network; upload the data and fetch its /_blob/<id>.`, line });
  }
  if (/\bnew\s+(?:WebSocket|EventSource)\s*\(|\bXMLHttpRequest\b/.test(code)) {
    out.push({ level: 'error', message: 'Opens a network connection (WebSocket / EventSource / XMLHttpRequest); artboards stay offline.', line });
  }
}
