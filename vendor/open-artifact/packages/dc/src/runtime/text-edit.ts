










import { TID_ATTRIBUTE } from '../render.ts';
import type { BoardEvent, BoardRect, ImportTextTargetSpec, TextEditOptions, TextEditTarget, TextFormat, TextFormats } from '../protocol.ts';
import { focusElement } from './focus-guard.ts';

/** Marks the element being edited (styled by {@link ensureStyle}). */
const EDITING_ATTRIBUTE = 'data-dc-editing';

/** Marks SVG text being edited. */
const SVG_EDITING_ATTRIBUTE = 'data-dc-editing-svg';

/** The selection color of the caret and marks drawn over SVG text. */
const MARK_COLOR = '#2a78d6';

/** Accessible name and role given to an element that has none while it is edited. */
const ARIA: [string, string][] = [
  ['role', 'textbox'],
  ['aria-label', 'Edit text'],
  ['aria-multiline', 'true'],
];

/** A whole-hole seed: `{{ prop }}`. */
const WHOLE_PROP = /^\s*\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}\s*$/;

/** Where a glyph of drawn text starts, on screen. */
interface Stop {
  x: number;
  y: number;
  /** Baseline angle, radians. */
  ang: number;
  /** Advance to the next glyph (0 past the end). */
  w: number;
  /** False for glyphs the browser does not draw (collapsed spaces). */
  drawn: boolean;
}

/** SVG text being edited: a hidden field takes the keys, the drawing mirrors it. */
interface SvgEdit {
  svg: SVGTextContentElement;
  /** The one text node the drawing shows while editing. */
  text: Text;
  /** Spaces are kept as typed (`white-space: pre`). */
  pre: boolean;
  /** The element's own inline `white-space`, restored after. */
  ws: string;
  startText: string;
  lastStop: Stop | null;
  /** Caret and selection marks. */
  marks: HTMLElement[];
  /** Where a drag started (a character index), and whether it moved. */
  anchor: number | null;
  down: { x: number; y: number; moved: boolean } | null;
}

/** Words of a component instance being edited in place. */
interface ImportEdit {
  /** The instance's mount (the stamped `<x-import>`). */
  mount: Element;
  /** The text node the words were in, emptied while the field stands in for it. */
  node: Text;
  /** Its value before. */
  value: string;
  startText: string;
  key: string;
  words: string;
  watch: MutationObserver;
}

/** One editing session. */
interface Session {
  /** What takes the keys: the element itself, or a stand-in field for drawn or component words. */
  element: HTMLElement;
  /** The template element being edited (the element, or the SVG text, or the instance's mount). */
  host: Element;
  tid: number;
  /** React's rendered children, put back when the edit ends. */
  saved: Node[];
  /** The content when the edit started: an unchanged edit reports nothing. */
  startHtml: string;
  /** Where the text is written when a hole shows it. */
  target: TextEditTarget | null;
  /** The element's own `contenteditable`, restored after. */
  ownEditable: string | null;
  /** ARIA attributes this edit added. */
  aria: string[];
  /** The last selection inside the element (restored when focus comes back for a format). */
  range: Range | null;
  /** The selection a `link-edit` is about. */
  linkRange: Range | null;
  /** The link just set: the editor selects it once the words are written. */
  newLink: Element | null;
  svg: SvgEdit | null;
  imported: ImportEdit | null;
  listeners: [EventTarget, string, EventListener, boolean?][];
}

/** Adds the editing style once. */
function ensureStyle(): void {
  if (document.getElementById('dc-text-edit-style')) return;
  const style = document.createElement('style');
  style.id = 'dc-text-edit-style';
  style.textContent = `[${EDITING_ATTRIBUTE}]{outline:none!important;cursor:text!important;user-select:text!important;-webkit-user-select:text!important}[${SVG_EDITING_ATTRIBUTE}]{cursor:text!important}`;
  document.head.appendChild(style);
}

/** The element a DOM node is or sits in. */
function elementOf(node: Node | null): Element | null {
  return node ? (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement) : null;
}





function linkAt(range: Range, root: HTMLElement): HTMLAnchorElement | null {
  const around = elementOf(range.commonAncestorContainer)?.closest('a');
  if (around) return around as HTMLAnchorElement;
  const words = String(range).trim();
  const links = Array.from(root.querySelectorAll('a')).filter((link) => range.intersectsNode(link));
  if (words === '' || links.length !== 1) return null;
  const link = links[0]!;
  const inner = document.createRange();
  inner.selectNodeContents(link);
  const clipped = range.cloneRange();
  if (clipped.compareBoundaryPoints(Range.START_TO_START, inner) < 0) clipped.setStart(inner.startContainer, inner.startOffset);
  if (clipped.compareBoundaryPoints(Range.END_TO_END, inner) > 0) clipped.setEnd(inner.endContainer, inner.endOffset);
  if (String(clipped).trim() !== words) return null;
  const media = Array.from(root.querySelectorAll('img, svg, picture, video')).some((node) => range.intersectsNode(node) && !link.contains(node));
  return media ? null : link;
}







function unlinkPart(link: HTMLElement, from: Node | null, to: Node | null): void {
  const parent = link.parentNode;
  if (!parent) return;
  const copy = (fragment: DocumentFragment): HTMLElement | null => {
    if (fragment.textContent === '' && !fragment.querySelector('*')) return null;
    const twin = link.cloneNode(false) as HTMLElement;
    twin.removeAttribute(TID_ATTRIBUTE);
    twin.appendChild(fragment);
    for (const stamped of Array.from(twin.querySelectorAll(`[${TID_ATTRIBUTE}]`))) stamped.removeAttribute(TID_ATTRIBUTE);
    return twin;
  };
  let split = false;
  if (from && link.contains(from)) {
    const before = document.createRange();
    before.setStart(link, 0);
    before.setEndBefore(from);
    if (!before.collapsed) {
      const twin = copy(before.extractContents());
      if (twin) split = parent.insertBefore(twin, link) !== null;
    }
  }
  if (to && link.contains(to)) {
    const after = document.createRange();
    after.setStartAfter(to);
    after.setEnd(link, link.childNodes.length);
    if (!after.collapsed) {
      const twin = copy(after.extractContents());
      if (twin) split = parent.insertBefore(twin, link.nextSibling) !== null;
    }
  }
  // Attributes that are more than "a link" (a class, a real style) stay on a span around the middle.
  let holder: Node = parent;
  for (const attr of Array.from(link.attributes)) {
    if (/^(href|target|rel|download|ping|hreflang|referrerpolicy|type)$|^data-dc-/.test(attr.name)) continue;
    if (attr.name === 'id' && split) continue;
    if (
      attr.name === 'style' &&
      /^\s*(((color|font[a-z-]*|line-height|letter-spacing|text-transform|text-decoration[a-z-]*|text-underline-offset):\s*inherit|text-decoration(-line)?:\s*(none|underline)|display:\s*block)[\s;]*)*$/.test(attr.value)
    ) {
      continue;
    }
    if (holder === parent) holder = parent.insertBefore(document.createElement('span'), link);
    (holder as Element).setAttribute(attr.name, attr.value);
  }
  while (link.firstChild) holder.insertBefore(link.firstChild, holder === parent ? link : null);
  parent.removeChild(link);
}

/** Text of an element as typed: text, `<br>` and block breaks as newlines. */
function typedText(root: Node): string {
  const out: string[] = [];
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) out.push(child.nodeValue ?? '');
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).tagName;
        if (tag === 'BR') out.push(child.nextSibling || child.previousSibling ? '\n' : '');
        else {
          if (out.length && (tag === 'DIV' || tag === 'P')) out.push('\n');
          walk(child);
        }
      }
    }
  };
  walk(root);
  return out.join('');
}

/** The caret position under a point, if the browser can tell. */
function caretAt(x: number, y: number): Range | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (typeof doc.caretRangeFromPoint === 'function') return doc.caretRangeFromPoint(x, y);
  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}





function placeCaret(element: HTMLElement, caret: TextEditOptions['caret'] = 'all'): void {
  const selection = getSelection();
  if (!selection) return;
  if (caret && typeof caret === 'object') {
    const range = caretAt(caret.x, caret.y);
    if (range && element.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    caret = 'end';
  }
  selection.removeAllRanges();
  const range = document.createRange();
  if (caret === 'all') {
    range.selectNodeContents(element);
    selection.addRange(range);
    return;
  }
  let node: Node = element;
  let pre = false;
  for (let last = node.lastChild; last; last = node.lastChild) {
    pre = /^pre|^break-spaces/.test(getComputedStyle(node as Element).whiteSpace || '');
    while (!pre && last.previousSibling && last.nodeType === Node.TEXT_NODE && /^\s*$/.test(last.nodeValue ?? '')) last = last.previousSibling;
    node = last;
    if (last.nodeType !== Node.ELEMENT_NODE || last.nodeName === 'A') break;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? '';
    range.setStart(node, pre ? value.length : value.replace(/\s+$/, '').length);
  } else if (node !== element) range.setStartAfter(node);
  else range.setStart(element, 0);
  range.collapse(true);
  selection.addRange(range);
}

/* ------------------------------ SVG text ------------------------------ */

/** The words SVG text shows, its spaces collapsed as drawn. */
function drawnSvgText(element: SVGTextContentElement): string {
  const text = (element.textContent ?? '').replace(/[ \t\r\n\f]+/g, ' ');
  let count = -1;
  try {
    count = element.getNumberOfChars();
  } catch {
    /* Not laid out. */
  }
  if (text.length === count) return text;
  if (text.length > 1 && text.startsWith(' ') && text.endsWith(' ') && text.length - 1 === count) {
    const outer = element.closest('text');
    let before = '';
    if (outer && outer !== element) {
      const range = document.createRange();
      range.setStart(outer, 0);
      range.setEndBefore(element);
      before = range.toString();
    }
    return /\S/.test(before) ? text.slice(0, -1) : text.slice(1);
  }
  return text.replace(/^ | $/g, '');
}

/** Screen pixels per user unit of SVG text. */
function svgScale(element: SVGGraphicsElement): number {
  try {
    const matrix = element.getScreenCTM();
    const scale = (matrix && Math.sqrt(matrix.a * matrix.a + matrix.b * matrix.b)) || 1;
    if (matrix && (matrix.b || matrix.c)) return scale;
    const outer = (element.closest('text') as SVGGraphicsElement | null) ?? element;
    const box = outer.getBBox();
    const rect = outer.getBoundingClientRect();
    return box.width > 0 && rect.width > 0 ? rect.width / box.width : scale;
  } catch {
    return 1;
  }
}

/** A point of SVG text in screen pixels. */
function svgPoint(element: SVGGraphicsElement, x: number, y: number): { x: number; y: number } {
  const matrix = element.getScreenCTM();
  if (matrix && (matrix.b || matrix.c)) {
    const point = new DOMPoint(x, y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }
  const outer = (element.closest('text') as SVGGraphicsElement | null) ?? element;
  const box = outer.getBBox();
  const rect = outer.getBoundingClientRect();
  const scale = box.width > 0 && rect.width > 0 ? rect.width / box.width : 1;
  return { x: rect.left + (x - box.x) * scale, y: rect.top + (y - box.y) * scale };
}

/** One caret stop per character, plus one after the last. */
function svgStops(element: SVGTextContentElement): Stop[] {
  const glyphs: (Stop | null)[] = [];
  let count = 0;
  try {
    count = element.getNumberOfChars();
  } catch {
    /* Not laid out. */
  }
  let first = -1;
  let last = -1;
  for (let index = 0; index < count; index++) {
    let stop: Stop | null = null;
    try {
      if (element.getExtentOfChar(index).width > 0) {
        const from = svgPoint(element, element.getStartPositionOfChar(index).x, element.getStartPositionOfChar(index).y);
        const to = svgPoint(element, element.getEndPositionOfChar(index).x, element.getEndPositionOfChar(index).y);
        stop = { x: from.x, y: from.y, ang: Math.atan2(to.y - from.y, to.x - from.x), w: Math.hypot(to.x - from.x, to.y - from.y), drawn: true };
        if (first < 0) first = index;
        last = index;
      }
    } catch {
      /* A glyph the browser does not place. */
    }
    glyphs.push(stop);
  }
  const stops: Stop[] = [];
  if (first < 0) return stops;
  const end = glyphs[last]!;
  const after = svgPoint(element, element.getEndPositionOfChar(last).x, element.getEndPositionOfChar(last).y);
  const tail: Stop = { x: after.x, y: after.y, ang: end.ang, w: 0, drawn: true };
  for (let index = 0; index <= count; index++) {
    const glyph = glyphs[index];
    if (index < count && glyph) stops.push(glyph);
    else if (index > last) stops.push(index === last + 1 ? tail : { ...tail, w: 0, drawn: false });
    else {
      let next = index;
      while (!glyphs[next]) next++;
      const at = glyphs[next]!;
      stops.push({ x: at.x, y: at.y, ang: at.ang, w: 0, drawn: false });
    }
  }
  return stops;
}

/** The caret stop nearest a point. */
function nearestStop(element: SVGTextContentElement, x: number, y: number): number {
  const stops = svgStops(element);
  let best = 0;
  let distance = Infinity;
  stops.forEach((stop, index) => {
    if (!stop.drawn) return;
    const d = (stop.x - x) ** 2 + (stop.y - y) ** 2;
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}

/** The selection in a field as character offsets [anchor, focus]. */
function fieldSelection(field: HTMLElement): [number, number] {
  const selection = getSelection();
  const length = (field.textContent ?? '').length;
  const offset = (node: Node | null, at: number): number => {
    if (!node || !field.contains(node)) return length;
    if (node === field) {
      let total = 0;
      for (let index = 0; index < at && index < field.childNodes.length; index++) total += (field.childNodes[index]!.textContent ?? '').length;
      return total;
    }
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    let total = 0;
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text === node) return total + at;
      total += (text.nodeValue ?? '').length;
    }
    return length;
  };
  if (!selection || !selection.rangeCount || !field.contains(selection.anchorNode)) return [length, length];
  return [offset(selection.anchorNode, selection.anchorOffset), offset(selection.focusNode, selection.focusOffset)];
}

/** Selects characters `from`..`to` of a field. */
function selectInField(field: HTMLElement, from: number, to: number): void {
  const locate = (at: number): [Node, number] => {
    const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    at = Math.max(0, at);
    for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
      if (at <= text.data.length) return [text, at];
      at -= text.data.length;
      last = text;
    }
    return last ? [last, last.data.length] : [field, 0];
  };
  const [anchorNode, anchorOffset] = locate(from);
  const [focusNode, focusOffset] = locate(to);
  focusElement(field);
  getSelection()?.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
}

/* ------------------------- words of a component ------------------------- */

/** A text node's words, spaces collapsed. */
const nodeWords = (node: Node): string => (node.nodeValue ?? '').replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '');

/** The words a point falls on: a text node whose drawn box holds the point. */
function textNodeAt(x: number, y: number): Text | null {
  const node = caretAt(x, y)?.startContainer ?? null;
  if (!node || node.nodeType !== Node.TEXT_NODE || (node.nodeValue ?? '').trim() === '') return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  for (const rect of Array.from(range.getClientRects())) {
    if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) return node as Text;
  }
  return null;
}







function importTextNode(mount: Element, targets: readonly ImportTextTargetSpec[], under: Text | null): { node: Text; key: string; words: string } | null {
  const own = (node: Node): boolean => {
    const parent = node.parentElement;
    return (
      node.nodeType === Node.TEXT_NODE &&
      Boolean(parent) &&
      mount.contains(node) &&
      parent!.closest(`[${TID_ATTRIBUTE}]`) === mount &&
      parent!.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
      !parent!.closest('textarea, select, option, title, script, style, noscript')
    );
  };
  const each = (visit: (node: Text) => boolean | void): void => {
    const walker = document.createTreeWalker(mount, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) if (visit(node) === false) return;
  };
  let found: Text | null = null;
  let unclear = false;
  if (under) {
    if (!own(under)) return null;
    const words = nodeWords(under);
    each((node) => {
      if (node !== under && own(node) && nodeWords(node) === words) return !(unclear = true);
    });
    found = under;
  } else {
    each((node) => {
      if (!own(node) || !/[\p{L}\p{N}]/u.test(node.nodeValue ?? '')) return;
      if (found) return !(unclear = true);
      found = node;
    });
  }
  if (!found || unclear) return null;
  const node: Text = found;
  const words = nodeWords(node);
  const target = targets.find((each) => each.words === words);
  if (!target) return null;
  if (target.number) {
    let digits = false;
    each((other) => {
      if (other !== node && own(other) && /\d/.test(other.nodeValue ?? '')) return !(digits = true);
    });
    if (digits) return null;
  }
  return { node, key: target.key, words };
}

/** True when the words are drawn where they can be seen and edited. */
function visibleWords(node: Text, mount: Element, underPoint: boolean): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = range.getClientRects();
  if (!rects.length || rects[0]!.height < 2 || getComputedStyle(parent).visibility !== 'visible') return false;
  for (let element: Element | null = parent; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
    if (parseFloat(style.opacity) === 0) return false;
    if (element !== mount && mount.contains(element) && clips && ((element as HTMLElement).offsetWidth < 2 || (element as HTMLElement).offsetHeight < 2)) return false;
  }
  if (underPoint) return true;
  const first = rects[0]!;
  const top = document.elementFromPoint(first.left + first.width / 2, first.top + first.height / 2);
  return Boolean(top && mount.contains(top));
}

/**
 * Sets SVG text up for editing: the drawing shows one text
 * node of its words, and a hidden field over it takes the keys.
 */
function svgField(svg: SVGTextContentElement): { edit: SvgEdit; field: HTMLElement } {
  const style = getComputedStyle(svg);
  const pre = /^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace);
  const startText = pre ? (svg.textContent ?? '') : drawnSvgText(svg);
  const ws = svg.style.getPropertyValue('white-space');
  svg.style.setProperty('white-space', 'pre');
  svg.setAttribute(SVG_EDITING_ATTRIBUTE, '');
  const field = document.createElement('div');
  field.setAttribute('role', 'textbox');
  field.setAttribute('aria-label', 'Edit text');
  field.style.cssText = `position:fixed;left:0;top:0;z-index:2147483646;opacity:0;pointer-events:none;overflow:hidden;white-space:pre;outline:none;font-size:${style.fontSize};`;
  const text = document.createTextNode(startText);
  svg.replaceChildren(text);
  field.textContent = startText;
  document.body.appendChild(field);
  return { edit: { svg, text, pre, ws, startText, lastStop: null, marks: [], anchor: null, down: null }, field };
}

/** Events that stay with a component's field while its words are edited. */
const FIELD_EVENTS = ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick'];
/**
 * Also kept from a component around an import field: React hears focus
 * through `focusin` / `focusout`, and a collection such as a menu would
 * otherwise take focus back to its item and end the edit. The field's own
 * `blur` listener still runs.
 */
const IMPORT_FIELD_EVENTS = [...FIELD_EVENTS, 'focusin', 'focusout', 'click'];

/** Escapes text for HTML. */
const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** True for a pasted address that becomes a link. */
const URL_PASTE = /^https?:\/\/\S+$/i;

/** In-place text editing of one element at a time. */
export class TextEditor {
  private session: Session | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly report: (event: BoardEvent) => void) {
    document.addEventListener('selectionchange', () => this.selectionChanged());
  }

  /** True while an element is being edited. */
  get active(): boolean {
    return this.session !== null;
  }

  /** The element being edited. */
  get element(): HTMLElement | null {
    return this.session?.element ?? null;
  }

  /** Starts editing `host` (template node `tid`). */
  start(host: Element, tid: number, options: TextEditOptions = {}): boolean {
    this.end(true);
    if (!host.isConnected) return false;
    const element = host as HTMLElement;
    ensureStyle();
    const rendered = element.textContent ?? '';
    let target: TextEditTarget | null = null;
    let seeded = false;
    if (options.seed != null) {
      const whole = WHOLE_PROP.exec(options.seed);
      const props = options.props ?? {};
      if (whole && Object.hasOwn(props, whole[1]!) && props[whole[1]!] === rendered) {
        target = { kind: 'prop', prop: whole[1]!, value: rendered };
      } else {
        const matches = rendered.trim() === '' ? [] : (options.literals ?? []).filter((literal) => literal.value === rendered);
        if (matches.length === 1) target = { kind: 'script', ...matches[0]! };
        else seeded = true;
      }
    }

    const saved = Array.from(element.childNodes);
    if (target) element.textContent = rendered;
    else if (seeded) element.innerHTML = options.seed!;
    else {
      const copies = saved.map((node) => node.cloneNode(true));
      for (const copy of copies) {
        if (copy.nodeType !== Node.ELEMENT_NODE) continue;
        (copy as Element).removeAttribute(TID_ATTRIBUTE);
        for (const stamped of Array.from((copy as Element).querySelectorAll(`[${TID_ATTRIBUTE}]`))) stamped.removeAttribute(TID_ATTRIBUTE);
      }
      element.replaceChildren(...copies);
    }

    const session: Session = {
      element,
      host,
      tid,
      saved,
      startHtml: element.innerHTML,
      target,
      ownEditable: element.getAttribute('contenteditable'),
      aria: [],
      range: null,
      linkRange: null,
      newLink: null,
      svg: null,
      imported: null,
      listeners: [],
    };
    this.session = session;
    if (host instanceof SVGElement) {
      // Drawn text takes no caret: a hidden field takes the keys and the drawing mirrors it.
      const { edit, field } = svgField(host as SVGTextContentElement);
      session.svg = edit;
      session.element = field;
    }
    const field = session.element;
    field.setAttribute('contenteditable', target || session.svg ? 'plaintext-only' : 'true');
    if ((target || session.svg) && field.getAttribute('contenteditable') !== 'plaintext-only') field.setAttribute('contenteditable', 'true');
    field.setAttribute(EDITING_ATTRIBUTE, '');
    if (!session.svg && !ARIA.some(([name]) => field.hasAttribute(name)) && !field.hasAttribute('aria-labelledby')) {
      for (const [name, value] of ARIA) field.setAttribute(name, value);
      session.aria = ARIA.map(([name]) => name);
    }
    this.listenField(session);
    focusElement(field);
    placeCaret(field, session.svg ? 'all' : options.caret);
    this.postState();
    if (session.svg) this.placeSvgField();
    return true;
  }

  




  startImport(mount: Element, tid: number, x: number, y: number, targets: readonly ImportTextTargetSpec[]): boolean {
    this.end(true);
    if (!mount.isConnected || !targets.length) return false;
    const under = textNodeAt(x, y);
    const found = importTextNode(mount, targets, under);
    if (!found || !visibleWords(found.node, mount, found.node === under)) return false;
    ensureStyle();
    const field = document.createElement('dc-edit-field');
    field.textContent = (found.node.nodeValue ?? '').replace(/[ \t\n\r\f]+/g, ' ');
    field.style.cssText = 'user-select:text!important;-webkit-user-select:text!important;';
    const watch = new MutationObserver(() => {
      if (this.session !== session) watch.disconnect();
      else if (!field.isConnected) this.end(false);
    });
    const session: Session = {
      element: field,
      host: mount,
      tid,
      saved: [],
      startHtml: field.innerHTML,
      target: { kind: 'import', key: found.key, words: found.words },
      ownEditable: null,
      aria: [],
      range: null,
      linkRange: null,
      newLink: null,
      svg: null,
      imported: { mount, node: found.node, value: found.node.nodeValue ?? '', startText: field.textContent, key: found.key, words: found.words, watch },
      listeners: [],
    };
    found.node.parentNode!.insertBefore(field, found.node.nextSibling);
    found.node.nodeValue = '';
    this.session = session;
    watch.observe(document.documentElement, { childList: true, subtree: true });
    // The component's own handlers do not see keys and clicks meant for the field.
    const keep = (event: Event): void => {
      if (this.session === session && field.contains(event.target as Node)) event.stopPropagation();
    };
    for (const type of IMPORT_FIELD_EVENTS) {
      document.addEventListener(type, keep, true);
      session.listeners.push([document, type, keep, true]);
    }
    field.setAttribute('contenteditable', 'plaintext-only');
    if (field.getAttribute('contenteditable') !== 'plaintext-only') field.setAttribute('contenteditable', 'true');
    field.setAttribute(EDITING_ATTRIBUTE, 'import');
    for (const [name, value] of ARIA) field.setAttribute(name, name === 'aria-multiline' ? 'false' : value);
    this.listenField(session);
    focusElement(field);
    placeCaret(field, 'all');
    this.postState();
    return true;
  }

  /** The field's own listeners: input, paste, and focus leaving. */
  private listenField(session: Session): void {
    const field = session.element;
    const listen = (on: EventTarget, type: string, listener: EventListener, capture = false): void => {
      on.addEventListener(type, listener, capture);
      session.listeners.push([on, type, listener, capture]);
    };
    listen(field, 'input', () => {
      const svg = session.svg;
      if (svg) {
        if (!svg.svg.isConnected) {
          this.end(false);
          return;
        }
        if (svg.text.parentNode !== svg.svg) svg.svg.replaceChildren(svg.text);
        svg.text.nodeValue = field.textContent ?? '';
        this.drawSvgMarks();
      }
      this.scheduleState();
    });
    listen(field, 'paste', (event) => this.paste(event as ClipboardEvent));
    listen(field, 'blur', () => {
      if (this.session === session) this.report({ type: 'text-blur' });
    });
    if (session.svg) {
      const svg = session.svg;
      listen(document, 'scroll', () => this.placeSvgField(), true);
      listen(window, 'resize', () => this.placeSvgField());
      listen(document, 'mousedown', (event) => this.svgPointerDown(event as MouseEvent), true);
      listen(document, 'mousemove', (event) => this.svgPointerMove(event as MouseEvent), true);
      listen(document, 'dblclick', (event) => {
        if (!this.onSvgText(event as MouseEvent)) return;
        event.preventDefault();
        event.stopPropagation();
        this.svgSelectWord(event as MouseEvent);
      }, true);
    }
  }

  /** Ends the edit, reporting the change (or none). */
  end(commit: boolean): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    if (this.stateTimer !== null) clearTimeout(this.stateTimer);
    this.stateTimer = null;
    const { element } = session;
    for (const [on, type, listener, capture] of session.listeners) on.removeEventListener(type, listener, capture);
    element.removeAttribute(EDITING_ATTRIBUTE);
    const finish = (live: boolean, changed: boolean, html: string, text: string, link?: number): void => {
      this.report({ type: 'text-state', active: false });
      if (!commit || !live || !changed) this.report({ type: 'text-cancel', tid: session.tid });
      else this.report({ type: 'text-commit', tid: session.tid, html, text, ...(session.target ? { target: session.target } : {}), ...(link !== undefined && link >= 0 ? { link } : {}) });
    };
    if (session.imported) {
      const imported = session.imported;
      imported.watch.disconnect();
      const text = element.textContent ?? '';
      const live = imported.mount.isConnected && element.isConnected;
      if (element.contains(document.activeElement)) element.blur();
      element.remove();
      if (imported.node.nodeValue === '') imported.node.nodeValue = imported.value;
      finish(live, text.trim() !== '' && text !== imported.startText, '', text);
      return;
    }
    if (session.svg) {
      const svg = session.svg;
      const text = element.textContent ?? '';
      if (element.contains(document.activeElement)) element.blur();
      element.remove();
      for (const mark of svg.marks) mark.remove();
      svg.svg.removeAttribute(SVG_EDITING_ATTRIBUTE);
      if (svg.ws) svg.svg.style.setProperty('white-space', svg.ws);
      else svg.svg.style.removeProperty('white-space');
      if (!svg.svg.getAttribute('style')) svg.svg.removeAttribute('style');
      svg.svg.replaceChildren(...session.saved);
      finish(svg.svg.isConnected, text.trim() !== '' && text !== svg.startText, escapeHtml(text), text);
      return;
    }
    if (session.ownEditable !== null) element.setAttribute('contenteditable', session.ownEditable);
    else element.removeAttribute('contenteditable');
    for (const name of session.aria) element.removeAttribute(name);
    // Which link was just set: the editor selects it once the words are written.
    const link = session.newLink && element.contains(session.newLink) ? Array.from(element.querySelectorAll('a')).indexOf(session.newLink as HTMLAnchorElement) : undefined;
    const html = element.innerHTML;
    const text = session.target ? typedText(element) : (element.innerText ?? '').replace(/\n$/, '');
    if (element.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur?.();
    // Hand React back the exact nodes it rendered; the source update re-renders the text.
    element.replaceChildren(...session.saved);
    finish(true, html !== session.startHtml, html, text, link);
  }

  /** Toggles a format on the selection. */
  format(verb: TextFormat): void {
    const session = this.session;
    if (!session || session.target || session.svg) return;
    this.refocus(session);
    try {
      FORMATS[verb](this, session);
    } catch {
      /* A command the browser refuses changes nothing. */
    }
    this.postState();
  }

  
  applyLink(href: string | null): void {
    const session = this.session;
    if (!session) return;
    const range = session.linkRange;
    session.linkRange = null;
    if (!range) {
      this.cancelLinkEdit();
      return;
    }
    const root = session.element;
    try {
      focusElement(root);
      const selection = getSelection();
      const found = linkAt(range, root);
      const inner = found && found !== root && root.contains(found) ? found : null;
      const outer = found && !inner ? found : null;
      const address = (href ?? '').trim();
      if (address === '') {
        // Unlink what the selection covers.
        let start: Text | null = null;
        let finish: Text | null = null;
        if (!range.collapsed) {
          finish = document.createTextNode('');
          const tail = range.cloneRange();
          tail.collapse(false);
          tail.insertNode(finish);
          start = document.createTextNode('');
          const head = range.cloneRange();
          head.collapse(true);
          head.insertNode(start);
        }
        const links: HTMLElement[] = inner ? [inner] : [];
        for (const link of Array.from(root.querySelectorAll('a'))) if (!links.includes(link) && range.intersectsNode(link)) links.push(link);
        for (const link of links) if (link !== root && root.contains(link)) unlinkPart(link, start, finish);
        start?.remove();
        finish?.remove();
      } else if (inner) {
        if ((inner.getAttribute('href') ?? '').trim() === address) {
          this.cancelLinkEdit();
          return;
        }
        inner.setAttribute('href', address);
        session.newLink = inner;
      } else if (!range.collapsed && !outer) {
        const finish = document.createTextNode('');
        const tail = range.cloneRange();
        tail.collapse(false);
        tail.insertNode(finish);
        const start = document.createTextNode('');
        const head = range.cloneRange();
        head.collapse(true);
        head.insertNode(start);
        // Links the selection overlaps give up that part first: links never nest.
        for (const link of Array.from(root.querySelectorAll('a'))) {
          if (link !== root && root.contains(link) && range.intersectsNode(link)) unlinkPart(link, start, finish);
        }
        range.setStartAfter(start);
        range.setEndBefore(finish);
        const link = document.createElement('a');
        link.setAttribute('href', address);
        try {
          range.surroundContents(link);
        } catch {
          link.appendChild(range.extractContents());
          range.insertNode(link);
        }
        try {
          selection?.removeAllRanges();
          const after = document.createRange();
          after.setStartAfter(link);
          after.collapse(true);
          selection?.addRange(after);
        } catch {
          /* The caret stays where it was. */
        }
        start.remove();
        finish.remove();
        session.newLink = link;
      }
    } catch {
      /* Leave the text as it is. */
    }
    // Setting a link ends the edit; the editor then selects the link.
    if (session.newLink) {
      this.end(true);
      return;
    }
    this.postState();
  }

  /** Answers a `link-edit` without a change. */
  cancelLinkEdit(): void {
    const session = this.session;
    if (!session) return;
    session.linkRange = null;
    this.refocus(session);
    this.postState();
  }

  /** Keys while editing; true when the key was handled here. */
  keydown(event: KeyboardEvent): boolean {
    const session = this.session;
    if (!session) return false;
    const { element } = session;
    const composing = event.isComposing || event.keyCode === 229;
    if (event.key === ' ' && !composing && !event.ctrlKey && !event.metaKey && !event.altKey && element.closest('button, summary')) {
      // A space must not press the button being retyped.
      event.preventDefault();
      document.execCommand('insertText', false, ' ');
      return true;
    }
    if (document.activeElement !== element && !element.contains(document.activeElement)) focusElement(element);
    if ((session.svg || session.imported) && event.key === 'Enter') {
      // One line: Enter ends the edit.
      if (composing) return false;
      event.preventDefault();
      this.end(true);
      return true;
    }
    if (event.key === 'Enter' && !event.shiftKey && !composing && !event.ctrlKey && !event.metaKey) {
      const item = elementOf(getSelection()?.anchorNode ?? null)?.closest('li');
      if (!(item && item !== element && element.contains(item))) {
        event.preventDefault();
        if (!document.execCommand('insertLineBreak')) document.execCommand('insertHTML', false, '<br>');
        return true;
      }
      return false;
    }
    if (event.key === 'Escape' || (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !composing)) {
      event.preventDefault();
      this.end(true);
      return true;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.format('link');
      return true;
    }
    if ((session.target || session.svg) && (event.metaKey || event.ctrlKey) && /^[biu]$/i.test(event.key)) {
      // Plain text: no formatting.
      event.preventDefault();
      return true;
    }
    return false;
  }

  /* ----------------------------- internals ----------------------------- */

  /** Focuses the element, putting back the selection it had when focus left. */
  private refocus(session: Session): void {
    try {
      focusElement(session.element);
      const selection = getSelection();
      const inside = selection && selection.rangeCount > 0 && session.element.contains(selection.getRangeAt(0).startContainer);
      if (!inside && session.range && selection) {
        selection.removeAllRanges();
        selection.addRange(session.range);
      } else if (!inside) placeCaret(session.element, 'end');
    } catch {
      /* Focus is the browser's to give. */
    }
  }

  private selectionChanged(): void {
    const session = this.session;
    if (!session) return;
    const selection = getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (session.element.contains(range.startContainer) && session.element.contains(range.endContainer)) session.range = range.cloneRange();
    }
    this.drawSvgMarks();
    this.scheduleState();
  }

  private scheduleState(): void {
    if (!this.session || this.stateTimer !== null) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (this.session) this.postState();
    }, 120);
  }

  
  postState(): void {
    const session = this.session;
    if (this.stateTimer !== null) clearTimeout(this.stateTimer);
    this.stateTimer = null;
    if (!session) {
      this.report({ type: 'text-state', active: false });
      return;
    }
    const formats: TextFormats = { bold: false, italic: false, underline: false, ul: false, ol: false, link: false };
    const plain = session.target !== null || session.svg !== null;
    if (!plain) {
      const query = (command: string): boolean => {
        try {
          return document.queryCommandState(command);
        } catch {
          return false;
        }
      };
      formats.bold = query('bold');
      formats.italic = query('italic');
      formats.ul = query('insertUnorderedList');
      formats.ol = query('insertOrderedList');
      const link = this.selectedLink(session);
      formats.link = link !== null;
      formats.underline = link ? (getComputedStyle(link).textDecorationLine || '').includes('underline') : query('underline');
    }
    this.report({ type: 'text-state', active: true, tid: session.tid, plain, formats });
  }

  /** The link at the selection inside the edited element. */
  selectedLink(session: Session): HTMLElement | null {
    const selection = getSelection();
    let link = elementOf(selection?.anchorNode ?? null)?.closest('a') as HTMLElement | null | undefined;
    if (!link && selection && selection.rangeCount > 0) link = linkAt(selection.getRangeAt(0), session.element);
    return link && session.element.contains(link) ? link : null;
  }

  /** Rect of a range or element in board pixels. */
  static rectOf(target: Range | Element): BoardRect {
    const rect = target.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  
  private paste(event: ClipboardEvent): void {
    const session = this.session;
    if (!session) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const address = text.trim();
    if (session.svg || session.imported) {
      // One line of words.
      event.preventDefault();
      event.stopPropagation();
      document.execCommand('insertText', false, text.replace(/[ \t]*[\r\n]+[ \t]*/g, ' '));
      return;
    }
    // Anything else pastes as the browser does; the words are cleaned when written.
    if (session.target || !URL_PASTE.test(address)) return;
    const selection = getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (session.element.contains(range.commonAncestorContainer)) {
        event.preventDefault();
        const found = linkAt(range, session.element);
        const link = found && found !== session.element && session.element.contains(found) ? found : document.createElement('a');
        link.setAttribute('href', address);
        if (link !== found) {
          try {
            range.surroundContents(link);
          } catch {
            link.appendChild(range.extractContents());
            range.insertNode(link);
          }
        }
        selection.removeAllRanges();
        const after = document.createRange();
        after.setStartAfter(link);
        after.collapse(true);
        selection.addRange(after);
        this.scheduleState();
      }
    }
  }

  /* ------------------------------ SVG text ------------------------------ */

  /** Keeps the hidden field over the drawn text and redraws the marks. */
  private placeSvgField(): void {
    const session = this.session;
    const svg = session?.svg;
    if (!svg) return;
    if (!svg.svg.isConnected) {
      this.end(false);
      return;
    }
    const rect = svg.svg.getBoundingClientRect();
    const field = session.element;
    if (rect.width > 0) {
      field.style.left = `${rect.left}px`;
      field.style.top = `${rect.top}px`;
      field.style.width = `${rect.width}px`;
      field.style.height = `${Math.max(rect.height, 1)}px`;
    }
    this.drawSvgMarks();
  }

  /** Draws the caret, or the selection, over the drawn text. */
  private drawSvgMarks(): void {
    const session = this.session;
    const svg = session?.svg;
    if (!svg) return;
    let used = 0;
    const mark = (stop: Stop, width: number, height: number, caret: boolean): void => {
      let element = svg.marks[used++];
      if (!element) {
        element = document.createElement('div');
        document.body.appendChild(element);
        svg.marks.push(element);
      }
      element.setAttribute('data-dc-svg-mark', caret ? 'caret' : 'sel');
      element.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;transform-origin:0 0;width:${caret ? 1.5 : width}px;height:${height * 1.05}px;background:${caret ? MARK_COLOR : `color-mix(in srgb,${MARK_COLOR} 32%,transparent)`};transform:translate(${stop.x}px,${stop.y}px) rotate(${stop.ang}rad) translate(0,${-height * 0.88}px);`;
      const animations = element.getAnimations?.() ?? [];
      if (caret && !animations.length) {
        element.animate?.([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], { duration: 1000, iterations: Infinity });
      }
      for (const animation of animations) {
        if (caret) animation.currentTime = 0;
        else animation.cancel();
      }
    };
    if (svg.svg.isConnected) {
      const stops = svgStops(svg.svg);
      const height = (parseFloat(getComputedStyle(svg.svg).fontSize) || 16) * svgScale(svg.svg);
      const [anchor, focus] = fieldSelection(session.element);
      const from = Math.min(anchor, focus);
      const to = Math.max(anchor, focus);
      const last = stops.length - 1;
      if (last < 0) {
        if (svg.lastStop) mark(svg.lastStop, 0, height, true);
      } else if (from === to || to > last + 1) {
        svg.lastStop = stops[Math.min(from, last)]!;
        mark(svg.lastStop, 0, height, true);
      } else {
        for (let index = from; index < to && index < last; index++) {
          const stop = stops[index]!;
          const previous = stops[index - 1];
          if (stop.w > 0 && !(index > from && previous && stop.x === previous.x && stop.y === previous.y)) mark(stop, stop.w, height, false);
        }
        svg.lastStop = stops[Math.min(to, last)]!;
      }
    }
    for (let index = used; index < svg.marks.length; index++) svg.marks[index]!.style.display = 'none';
  }

  
  private onSvgText(event: MouseEvent): boolean {
    const svg = this.session?.svg;
    const target = event.target as Element | null;
    if (!svg || !target) return false;
    if (svg.svg.contains(target)) return true;
    if (!(target instanceof SVGElement) || ((target as SVGElement).ownerSVGElement ?? target) !== svg.svg.ownerSVGElement) return false;
    const pad = (parseFloat(getComputedStyle(svg.svg).fontSize) || 16) * svgScale(svg.svg);
    const rect = svg.svg.getBoundingClientRect();
    return event.clientX >= rect.left - pad && event.clientX <= rect.right + pad && event.clientY >= rect.top - pad && event.clientY <= rect.bottom + pad;
  }

  /** A press on the drawn text places the caret there; three select it all. */
  private svgPointerDown(event: MouseEvent): void {
    const session = this.session;
    const svg = session?.svg;
    if (!svg || !this.onSvgText(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    const field = session.element;
    if (event.detail >= 3) {
      svg.anchor = null;
      selectInField(field, 0, (field.textContent ?? '').length);
      this.drawSvgMarks();
      return;
    }
    const at = nearestStop(svg.svg, event.clientX, event.clientY);
    const [anchor] = fieldSelection(field);
    svg.down = { x: event.clientX, y: event.clientY, moved: false };
    svg.anchor = event.shiftKey ? anchor : at;
    selectInField(field, svg.anchor, at);
    this.drawSvgMarks();
  }

  /** Dragging over the drawn text selects. */
  private svgPointerMove(event: MouseEvent): void {
    const session = this.session;
    const svg = session?.svg;
    if (!svg || svg.anchor === null) return;
    if (!(event.buttons & 1)) {
      svg.anchor = null;
      return;
    }
    if (svg.down && Math.abs(event.clientX - svg.down.x) + Math.abs(event.clientY - svg.down.y) > 4) svg.down.moved = true;
    selectInField(session.element, svg.anchor, nearestStop(svg.svg, event.clientX, event.clientY));
    this.drawSvgMarks();
  }

  /** A double-click on the drawn text selects the word there. */
  private svgSelectWord(event: MouseEvent): void {
    const session = this.session;
    const svg = session?.svg;
    if (!svg || svg.down?.moved) return;
    const text = session.element.textContent ?? '';
    const at = nearestStop(svg.svg, event.clientX, event.clientY);
    let from = at;
    let to = at;
    while (from > 0 && /\S/.test(text.charAt(from - 1))) from--;
    while (to < text.length && /\S/.test(text.charAt(to))) to++;
    selectInField(session.element, from, to);
    this.drawSvgMarks();
  }

  
  askLink(session: Session): void {
    const root = session.element;
    const selection = getSelection();
    let link = elementOf(selection?.anchorNode ?? null)?.closest('a') as HTMLElement | null | undefined;
    if (!link && selection && selection.rangeCount > 0) link = linkAt(selection.getRangeAt(0), root);
    if (link && !root.contains(link)) link = null;
    let rect: BoardRect | null = null;
    let collapsed = true;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      session.linkRange = range.cloneRange();
      collapsed = range.collapsed;
      rect = TextEditor.rectOf(range);
    }
    if ((!rect || (!rect.width && !rect.height)) && link) rect = TextEditor.rectOf(link);
    if (!rect || (!rect.width && !rect.height)) rect = TextEditor.rectOf(root);
    // A caret in a link edits that link.
    if (link && session.linkRange?.collapsed) session.linkRange.selectNode(link);
    if (link === root) {
      // The edited element is the link: its own address (an attribute of the template element).
      session.linkRange = null;
      this.report({ type: 'link-edit', href: link.getAttribute('href') ?? '', collapsed: false, rect: TextEditor.rectOf(root), host: true });
      return;
    }
    this.report({ type: 'link-edit', href: link?.getAttribute('href') ?? '', collapsed: collapsed && !link, rect });
  }
}


const FORMATS: Record<TextFormat, (editor: TextEditor, session: Session) => void> = {
  bold: () => document.execCommand('bold'),
  italic: () => document.execCommand('italic'),
  underline: (editor, session) => {
    const selection = getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const links: HTMLElement[] = [];
    if (range) {
      if (session.element.tagName === 'A') links.push(session.element);
      for (const link of Array.from(session.element.querySelectorAll('a'))) if (range.intersectsNode(link)) links.push(link);
    }
    const link = editor.selectedLink(session);
    const on = link ? !(getComputedStyle(link).textDecorationLine || '').includes('underline') : !document.queryCommandState('underline');
    document.execCommand('underline');
    if (document.queryCommandState('underline') !== on) document.execCommand('underline');
    // A link's own underline is its style, not a <u>.
    for (const each of links) {
      const lines = (getComputedStyle(each).textDecorationLine || '').split(/\s+/).filter((line) => line && line !== 'none');
      const has = lines.includes('underline');
      if (on && !has) lines.push('underline');
      if (!on && has) lines.splice(lines.indexOf('underline'), 1);
      each.style.textDecorationLine = lines.length ? lines.join(' ') : 'none';
    }
  },
  ul: () => document.execCommand('insertUnorderedList'),
  ol: () => document.execCommand('insertOrderedList'),
  link: (editor, session) => editor.askLink(session),
};
