/**
 * Renders a template tree with React.
 *
 * The template is walked as written; nothing is compiled to code, so a
 * template can never run anything the logic class did not return. Each DOM
 * element gets `data-dc-tpl="<tid>"` so the editor can map what the viewer
 * clicks back to the template node.
 */

import {
  Fragment,
  createElement,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { VOID_ELEMENTS, attributeValue, type HtmlAttribute, type HtmlElement, type HtmlNode } from './html.ts';
import { evaluateHole, interpolate, wholeHole, type Scope } from './holes.ts';
import { toReactStyle } from './style.ts';
import type { TemplateModel } from './template.ts';

/** Attribute naming the template node a DOM element came from. */
export const TID_ATTRIBUTE = 'data-dc-tpl';
/** Attribute marking a `<dc-import>` / `<x-import>` boundary: clicks inside select the import. */
export const BOUNDARY_ATTRIBUTE = 'data-dc-boundary';

/** What the renderer needs from its host. */
export interface RenderHost {
  /**
   * The component for `<dc-import name>`; `undefined` while it loads,
   * `null` when it failed (the error is reported by the host).
   */
  importComponent(name: string): ComponentType<Record<string, unknown>> | null | undefined;
  /** Resolves `<x-import component-from-global-scope="Ns.Comp">`. */
  globalComponent(path: string): ComponentType<Record<string, unknown>> | null;
  /** Where `<helmet>` content goes; `null` drops it. */
  head: Element | null;
  /** Stamp {@link TID_ATTRIBUTE} on elements (off inside imported children). */
  stamp: boolean;
  /** Values are still arriving: unresolved loops and branches use their `hint-*` placeholders. */
  streaming: boolean;
}

/** HTML attribute names React spells differently. */
const ATTRIBUTE_NAMES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin',
  srcset: 'srcSet',
  autoplay: 'autoPlay',
  autofocus: 'autoFocus',
  autocomplete: 'autoComplete',
  novalidate: 'noValidate',
  spellcheck: 'spellCheck',
  enterkeyhint: 'enterKeyHint',
  inputmode: 'inputMode',
  playsinline: 'playsInline',
  referrerpolicy: 'referrerPolicy',
  datetime: 'dateTime',
  usemap: 'useMap',
  frameborder: 'frameBorder',
  'accept-charset': 'acceptCharset',
  'http-equiv': 'httpEquiv',
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
};

/** SVG tags whose camel case matters. */
const SVG_CAMEL_TAGS = new Map(
  [
    'clipPath', 'foreignObject', 'linearGradient', 'radialGradient', 'textPath', 'feBlend', 'feColorMatrix',
    'feComposite', 'feDropShadow', 'feFlood', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feOffset',
    'feTurbulence', 'feDisplacementMap', 'animateTransform', 'animateMotion',
  ].map((name) => [name.toLowerCase(), name]),
);

/** Parents in which whitespace text is not allowed. */
const NO_TEXT_PARENTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'helmet', 'svg', 'g', 'defs']);

/** Template-only attributes that never reach the DOM. */
const CONTROL_ATTRIBUTES = new Set(['hint-placeholder-count', 'hint-placeholder-val', 'hint-size']);

/** React prop name of an attribute. */
export function reactAttributeName(name: string): string {
  const lower = name.toLowerCase();
  if (ATTRIBUTE_NAMES[lower]) return ATTRIBUTE_NAMES[lower];
  if (lower.startsWith('data-') || lower.startsWith('aria-')) return lower;
  if (name.includes('-')) return name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
  return name;
}

/** The value of an attribute for React: literal string, raw hole value, or interpolated string. */
function attributeProp(attr: HtmlAttribute, scopes: readonly Scope[]): unknown {
  if (attr.value === null) return true;
  const hole = wholeHole(attr.value);
  if (hole) return evaluateHole(hole, scopes);
  return interpolate(attr.value, scopes);
}

/** Builds the React props of a plain element. */
function elementProps(element: HtmlElement, tid: number, scopes: readonly Scope[], host: RenderHost): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const hasChange = element.attrs.some((attr) => /^on(change|input)$/i.test(attr.name));
  for (const attr of element.attrs) {
    if (CONTROL_ATTRIBUTES.has(attr.name.toLowerCase())) continue;
    const name = reactAttributeName(attr.name);
    let value = attributeProp(attr, scopes);
    // Event handlers must be functions; inline handler strings never run.
    if (/^on[A-Za-z]/.test(name)) {
      if (typeof value !== 'function') continue;
      props[name.length > 2 ? `on${name[2]!.toUpperCase()}${name.slice(3)}` : name] = value;
      continue;
    }
    if (name === 'style') {
      if (typeof value === 'string') value = toReactStyle(value);
      else if (!value || typeof value !== 'object') continue;
    }
    // Uncontrolled form fields unless the logic class handles changes.
    if ((name === 'value' || name === 'checked') && !hasChange && ['input', 'textarea', 'select'].includes(element.tag)) {
      props[name === 'value' ? 'defaultValue' : 'defaultChecked'] = value;
      continue;
    }
    if (value === undefined || value === null || value === false) {
      if (value === false && (name.startsWith('aria-') || name.startsWith('data-'))) props[name] = 'false';
      continue;
    }
    props[name] = value;
  }
  if (host.stamp) props[TID_ATTRIBUTE] = String(tid);
  return props;
}

/** Converts a `hint-size="W,H"` to a placeholder style. */
function hintSizeStyle(hint: string | undefined): Record<string, string> {
  const [width, height] = (hint ?? '').split(',').map((part) => part.trim());
  return { width: width || '100%', height: height || '80px' };
}

/** Props passed to an imported component: every attribute but `name` and hints, kebab → camel. */
function importProps(element: HtmlElement, scopes: readonly Scope[], skip: readonly string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const attr of element.attrs) {
    const lower = attr.name.toLowerCase();
    if (skip.includes(lower) || CONTROL_ATTRIBUTES.has(lower)) continue;
    const key = attr.name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
    props[key] = attributeProp(attr, scopes);
  }
  return props;
}

/** Renders a template against render values. */
export function renderTemplate(model: TemplateModel, values: Record<string, unknown>, host: RenderHost): ReactNode {
  const helmet: ReactNode[] = [];
  const body = renderNodes(model, model.nodes, null, [values], host, helmet);
  const head = host.head && helmet.length ? createPortal(createElement(Fragment, null, ...helmet), host.head) : null;
  return createElement(Fragment, null, head, ...body);
}

/** Renders a list of sibling nodes. */
function renderNodes(
  model: TemplateModel,
  nodes: readonly HtmlNode[],
  parent: HtmlElement | null,
  scopes: readonly Scope[],
  host: RenderHost,
  helmet: ReactNode[],
): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((node, index) => {
    if (node.type === 'comment') return;
    if (node.type === 'text') {
      if (parent && (parent.tag === 'style' || parent.tag === 'script')) {
        out.push(node.value);
        return;
      }
      if (!/\S/.test(node.value)) {
        // Formatting whitespace: one space between inline siblings, nothing at the edges.
        const atEdge = index === 0 || index === nodes.length - 1;
        if (!atEdge && !(parent && NO_TEXT_PARENTS.has(parent.tag)) && node.value.length > 0) out.push(' ');
        return;
      }
      out.push(interpolate(node.value, scopes));
      return;
    }
    out.push(renderElement(model, node, scopes, host, helmet, index));
  });
  return out;
}

/** Renders one element (or structure tag). */
function renderElement(
  model: TemplateModel,
  element: HtmlElement,
  scopes: readonly Scope[],
  host: RenderHost,
  helmet: ReactNode[],
  key: number,
): ReactNode {
  const tid = model.tidOf.get(element) ?? -1;
  switch (element.tag) {
    case 'helmet': {
      helmet.push(...renderNodes(model, element.children, element, scopes, host, helmet).map((child, i) => withKey(child, `h${tid}-${i}`)));
      return null;
    }
    case 'script':
      // Scripts in the template never run; logic lives in the data-dc-script block.
      return null;
    case 'sc-for': {
      const list = evaluateList(element, scopes);
      const as = attributeValue(element, 'as') || 'item';
      let items: unknown[] | null = Array.isArray(list) ? list : null;
      if (!items && (host.streaming || list === undefined)) {
        const count = Number(attributeValue(element, 'hint-placeholder-count') ?? 0);
        items = Number.isFinite(count) && count > 0 ? Array.from({ length: Math.min(count, 50) }, () => undefined) : [];
      }
      return createElement(
        Fragment,
        { key },
        ...(items ?? []).map((item, $index) =>
          createElement(
            Fragment,
            { key: $index },
            ...renderNodes(model, element.children, element, [{ [as]: item, $index }, ...scopes], host, helmet),
          ),
        ),
      );
    }
    case 'sc-if': {
      const attr = element.attrs.find((a) => a.name.toLowerCase() === 'value');
      let value = attr ? attributeProp(attr, scopes) : undefined;
      if (value === undefined && host.streaming) {
        const hint = element.attrs.find((a) => a.name.toLowerCase() === 'hint-placeholder-val');
        value = hint ? attributeProp(hint, scopes) : false;
      }
      if (!value) return null;
      return createElement(Fragment, { key }, ...renderNodes(model, element.children, element, scopes, host, helmet));
    }
    case 'dc-import': {
      const name = attributeValue(element, 'name') ?? '';
      const Component = host.importComponent(name);
      const boundary = { key, style: { display: 'contents' }, [BOUNDARY_ATTRIBUTE]: 'dc-import', ...(host.stamp ? { [TID_ATTRIBUTE]: String(tid) } : {}) };
      if (!Component) {
        const placeholder = createElement('div', {
          style: { ...hintSizeStyle(attributeValue(element, 'hint-size')), background: 'rgba(127,127,127,0.08)', borderRadius: 4 },
          'data-dc-placeholder': name,
        });
        return createElement('div', boundary, placeholder);
      }
      return createElement('div', boundary, createElement(Component, importProps(element, scopes, ['name'])));
    }
    case 'x-import': {
      const path = attributeValue(element, 'component-from-global-scope') ?? '';
      const Component = host.globalComponent(path);
      const boundary = { key, style: { display: 'contents' }, [BOUNDARY_ATTRIBUTE]: 'x-import', ...(host.stamp ? { [TID_ATTRIBUTE]: String(tid) } : {}) };
      if (!Component) return createElement('div', boundary);
      // Content between the tags is the component's children (`<x-import …>Save</x-import>`).
      const children = renderNodes(model, element.children, element, scopes, host, helmet);
      return createElement('div', boundary, createElement(Component, importProps(element, scopes, ['component-from-global-scope']), ...children));
    }
    default:
      break;
  }

  const props = elementProps(element, tid, scopes, host);
  props.key = key;
  const type = SVG_CAMEL_TAGS.get(element.tag) ?? (element.rawTag.includes('-') ? element.rawTag : element.tag);
  if (VOID_ELEMENTS.has(element.tag)) return createElement(type, props);
  if (element.tag === 'textarea') {
    const text = element.children.map((child) => (child.type === 'text' ? interpolate(child.value, scopes) : '')).join('');
    if (!('value' in props) && !('defaultValue' in props)) props.defaultValue = text;
    return createElement(type, props);
  }
  if (element.tag === 'style') {
    // One string child so React does not split the stylesheet.
    const css = element.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
    return createElement(type, props, css);
  }
  return createElement(type, props, ...renderNodes(model, element.children, element, scopes, host, helmet));
}

/** Evaluates `<sc-for list>`. */
function evaluateList(element: HtmlElement, scopes: readonly Scope[]): unknown {
  const raw = attributeValue(element, 'list');
  if (raw === undefined) return undefined;
  const hole = wholeHole(raw);
  // A list must be one whole hole; anything else renders nothing (check reports it).
  return hole ? evaluateHole(hole, scopes) : undefined;
}

/** Gives a rendered child a key (helmet children are collected across the tree). */
function withKey(node: ReactNode, key: string): ReactNode {
  if (node && typeof node === 'object' && 'type' in node) {
    return createElement(Fragment, { key }, node);
  }
  return node;
}
