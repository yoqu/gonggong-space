/**
 * Edits to a template, expressed as text splices.
 *
 * Every edit names elements of a {@link TemplateModel} and returns the new
 * template text. Only the bytes an edit touches change: an attribute edit
 * rewrites that attribute, a text edit rewrites the element's content, a
 * removal cuts the element and the whitespace that introduced it. Several
 * edits can be combined with {@link applyEdits} as long as their ranges do
 * not overlap.
 */

import {
  VOID_ELEMENTS,
  elementChildren,
  escapeAttribute,
  escapeText,
  getAttribute,
  type HtmlElement,
  type HtmlNode,
} from './html.ts';
import { hasHoles } from './holes.ts';
import { isRichTextElement } from './rich-text.ts';
import { patchStyle, type StylePatch } from './style.ts';
import type { TemplateModel } from './template.ts';

/** Replace `[start, end)` of the template text with `text`. */
export interface Splice {
  start: number;
  end: number;
  text: string;
}

/** Thrown when an edit cannot be expressed on this element. */
export class EditError extends Error {
  override name = 'EditError';
}

/** Applies splices (in any order) to a text. Overlapping splices throw. */
export function applySplices(text: string, splices: readonly Splice[]): string {
  const sorted = [...splices].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const splice of sorted) {
    if (splice.end > floor) throw new EditError('Edits overlap.');
    out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
    floor = splice.start;
  }
  return out;
}

/** Applies the splices of several edits to the model's text. */
export function applyEdits(model: TemplateModel, edits: readonly (readonly Splice[])[]): string {
  return applySplices(model.text, edits.flat());
}

/* -------------------------------------------------------------------------- */
/* Attributes                                                                  */
/* -------------------------------------------------------------------------- */

/** Writes `name="value"`, single-quoting values that contain `"` but no `'`. */
export function formatAttribute(name: string, value: string | null): string {
  if (value === null) return name;
  if (value.includes('"') && !value.includes("'")) return `${name}='${value.replace(/&/g, '&amp;')}'`;
  return `${name}="${escapeAttribute(value)}"`;
}

/** Where a new attribute goes: right before `>` or `/>`. */
function attributeInsertPoint(model: TemplateModel, element: HtmlElement): number {
  let at = element.openEnd - 1;
  if (element.selfClosing && model.text[at - 1] === '/') at--;
  while (at > element.start && /\s/.test(model.text[at - 1]!)) at--;
  return at;
}

/** Sets (or, with `null`, removes) an attribute. `undefined` value = bare attribute. */
export function setAttribute(
  model: TemplateModel,
  element: HtmlElement,
  name: string,
  value: string | null | { bare: true },
): Splice[] {
  const attr = getAttribute(element, name);
  if (value === null) {
    if (!attr) return [];
    let start = attr.start;
    while (start > element.start && /\s/.test(model.text[start - 1]!)) start--;
    return [{ start, end: attr.end, text: '' }];
  }
  const written = typeof value === 'string' ? formatAttribute(attr?.name ?? name, value) : (attr?.name ?? name);
  if (attr) return [{ start: attr.start, end: attr.end, text: written }];
  const at = attributeInsertPoint(model, element);
  return [{ start: at, end: at, text: ` ${written}` }];
}

/** True when the element's style is a whole-value hole (`style="{{s}}"`), which the panel must not rewrite. */
export function hasDynamicStyle(element: HtmlElement): boolean {
  const value = getAttribute(element, 'style')?.value ?? '';
  return /^\s*\{\{[^}]*\}\}\s*$/.test(value);
}

/** Patches the inline style. */
export function setStyle(model: TemplateModel, element: HtmlElement, patch: StylePatch): Splice[] {
  if (hasDynamicStyle(element)) throw new EditError('This element takes its whole style from the logic class.');
  const current = getAttribute(element, 'style')?.value ?? '';
  const next = patchStyle(current, patch);
  return setAttribute(model, element, 'style', next === '' ? null : next);
}

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * True when the element's words are edited in place: words and inline
 * formatting, as written in the template (see {@link isRichTextElement}).
 */
export function isTextEditable(element: HtmlElement): boolean {
  return isRichTextElement(element);
}

/** True when the element holds plain text only (words and `<br>`, no holes). */
export function holdsPlainText(element: HtmlElement): boolean {
  if (VOID_ELEMENTS.has(element.tag) || element.closeStart < 0) return false;
  if (['script', 'style', 'helmet', 'sc-for', 'sc-if', 'dc-import', 'x-import', 'svg'].includes(element.tag)) return false;
  for (const child of element.children) {
    if (child.type === 'element' && child.tag !== 'br') return false;
    if (child.type === 'text' && hasHoles(child.value)) return false;
  }
  return true;
}

/**
 * Replaces the element's content with text. Newlines become `<br>`, matching
 * how a content-editable element reports line breaks.
 */
export function setText(element: HtmlElement, text: string): Splice[] {
  if (!holdsPlainText(element)) throw new EditError('This element does not hold plain text.');
  const html = text.split('\n').map(escapeText).join('<br>');
  return [{ start: element.openEnd, end: element.closeStart, text: html }];
}

/** Replaces the element's content with raw HTML (already sanitized by the caller). */
export function setInnerHtml(element: HtmlElement, html: string): Splice[] {
  if (VOID_ELEMENTS.has(element.tag) || element.closeStart < 0) throw new EditError('This element has no content.');
  return [{ start: element.openEnd, end: element.closeStart, text: html }];
}

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

/** The whitespace text right before a node among its siblings (`''` when none). */
function leadingWhitespace(model: TemplateModel, node: HtmlNode): { start: number; text: string } {
  let start = node.start;
  while (start > 0 && /[ \t]/.test(model.text[start - 1]!)) start--;
  if (start > 0 && model.text[start - 1] === '\n') start--;
  if (start > 0 && model.text[start - 1] === '\r') start--;
  return { start, text: model.text.slice(start, node.start) };
}

/** Removes elements together with the line break and indent that introduced each. */
export function removeElements(model: TemplateModel, elements: readonly HtmlElement[]): Splice[] {
  const outermost = elements.filter((element) => !elements.some((other) => other !== element && contains(other, element)));
  return outermost.map((element) => ({ start: leadingWhitespace(model, element).start, end: element.end, text: '' }));
}

/** True when `outer` contains `inner` (or is it). */
export function contains(outer: HtmlElement, inner: HtmlNode): boolean {
  for (let node: HtmlNode | null = inner; node; node = node.parent) if (node === outer) return true;
  return false;
}

/** The element's source text. */
export function elementSource(model: TemplateModel, element: HtmlElement): string {
  return model.text.slice(element.start, element.end);
}

/** The line-break-plus-indent to put before a new sibling of `element`. */
function siblingSeparator(model: TemplateModel, element: HtmlElement): string {
  const lead = leadingWhitespace(model, element).text;
  return lead.includes('\n') ? lead : '';
}

/** Inserts a copy of each element right after it. */
export function duplicateElements(model: TemplateModel, elements: readonly HtmlElement[]): Splice[] {
  const outermost = elements.filter((element) => !elements.some((other) => other !== element && contains(other, element)));
  return outermost.map((element) => ({
    start: element.end,
    end: element.end,
    text: siblingSeparator(model, element) + elementSource(model, element),
  }));
}

/** Where to insert relative to a reference element. */
export type InsertPosition = 'before' | 'after' | 'first-child' | 'last-child';

/** Inserts HTML relative to an element (or, with `null`, at the end of the template). */
export function insertHtml(model: TemplateModel, target: HtmlElement | null, position: InsertPosition, html: string): Splice[] {
  if (!target) {
    const tops = elementChildren(model.nodes);
    const last = tops[tops.length - 1];
    if (!last) return [{ start: model.text.length, end: model.text.length, text: `\n${html}\n` }];
    return [{ start: last.end, end: last.end, text: (siblingSeparator(model, last) || '\n') + html }];
  }
  if (position === 'before') {
    const separator = siblingSeparator(model, target);
    return [{ start: leadingWhitespace(model, target).start, end: leadingWhitespace(model, target).start, text: separator + html }];
  }
  if (position === 'after') {
    return [{ start: target.end, end: target.end, text: siblingSeparator(model, target) + html }];
  }
  if (VOID_ELEMENTS.has(target.tag) || target.closeStart < 0) throw new EditError('This element cannot hold children.');
  const kids = elementChildren(target);
  if (position === 'first-child') {
    const first = kids[0];
    if (first) return insertHtml(model, first, 'before', html);
  } else {
    const last = kids[kids.length - 1];
    if (last) return insertHtml(model, last, 'after', html);
  }
  // Empty element: indent one step deeper than the element itself.
  const indent = siblingSeparator(model, target);
  const inner = indent ? `${indent}  ` : '';
  const content = model.text.slice(target.openEnd, target.closeStart);
  const tail = content.trim() === '' ? indent : '';
  return [{ start: target.openEnd, end: target.closeStart, text: `${content.trim() === '' ? '' : content}${inner}${html}${tail}` }];
}

/**
 * Moves elements next to (or into) a target, keeping their order. The moved
 * source text is carried verbatim.
 */
export function moveElements(
  model: TemplateModel,
  elements: readonly HtmlElement[],
  target: HtmlElement,
  position: InsertPosition,
): Splice[] {
  const moving = elements
    .filter((element) => !elements.some((other) => other !== element && contains(other, element)))
    .sort((a, b) => a.start - b.start);
  if (moving.some((element) => contains(element, target))) throw new EditError('Cannot move an element into itself.');
  const separator = siblingSeparator(model, target) || '\n';
  const html = moving.map((element) => elementSource(model, element)).join(separator);
  return [...removeElements(model, moving), ...insertHtml(model, target, position, html)];
}

/** Wraps elements (siblings, in source order) in a new container. */
export function wrapElements(model: TemplateModel, elements: readonly HtmlElement[], openTag: string, closeTag: string): Splice[] {
  const sorted = [...elements].sort((a, b) => a.start - b.start);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [];
  if (sorted.some((element) => element.parent !== first.parent)) throw new EditError('Only siblings can be wrapped together.');
  const indent = siblingSeparator(model, first);
  const inner = model.text
    .slice(first.start, last.end)
    .split('\n')
    .map((line, index) => (index === 0 || line.trim() === '' ? line : `  ${line}`))
    .join('\n');
  const innerIndent = indent ? `${indent}  ` : '';
  return [{ start: first.start, end: last.end, text: `${openTag}${innerIndent}${inner}${indent}${closeTag}` }];
}

/** Replaces an element with its children. */
export function unwrapElement(model: TemplateModel, element: HtmlElement): Splice[] {
  if (element.closeStart < 0) throw new EditError('This element has no children to keep.');
  const content = model.text.slice(element.openEnd, element.closeStart).replace(/^\s*\n/, '').replace(/\n\s*$/, '');
  const dedented = content
    .split('\n')
    .map((line) => line.replace(/^ {2}/, ''))
    .join('\n')
    .trimStart();
  return [{ start: element.start, end: element.end, text: dedented }];
}
