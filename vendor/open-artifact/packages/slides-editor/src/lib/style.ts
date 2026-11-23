/**
 * Style edits from the properties panel go through the same property table
 * the compiler uses, so a value typed by hand is stored in its canonical
 * spelling (or refused with the compiler's reason).
 */

import {
  isPinned,
  nodeAt,
  parentAt,
  parseDeclaration,
  type CssProperty,
  type ElementKind,
  type NodePath,
  type Slide,
  type SlideNode,
  type StyleContext,
  type StylePatch,
} from '@open-artifact/slides-core';

/** The element kind of a node, for the property table. */
export function elementKindOf(node: SlideNode | null): ElementKind {
  if (!node) return 'section';
  switch (node.kind) {
    case 'text':
      return 'text';
    case 'list':
      return 'list';
    case 'textbox':
      return 'textbox';
    case 'box':
      return 'div';
    case 'image':
      return 'img';
    case 'table':
      return 'table';
    case 'svg':
      return 'svg';
    case 'shape':
      return 'shape';
    case 'icon':
      return 'icon';
    case 'connector':
      return 'connector';
    case 'embed':
      return 'embed';
    case 'rule':
      return 'hr';
  }
}

/** The property-table context of the element at `path` (the section for []). */
export function styleContextOf(slide: Slide, path: NodePath, faces: ReadonlySet<string>): StyleContext {
  const node = path.length ? (nodeAt(slide, path) ?? null) : null;
  const style = node ? node.style : slide.style;
  const parentStyle = path.length > 1 ? parentAt(slide, path)?.style : slide.style;
  const pinned = node ? isPinned(node) : false;
  const display = style.display === 'grid' ? 'grid' : style.display === 'none' ? 'none' : 'flex';
  return {
    element: elementKindOf(node),
    ...(node?.kind === 'shape' ? { shape: node.shape } : {}),
    pinned,
    flowChild: Boolean(node) && !pinned,
    gridChild: Boolean(node) && !pinned && parentStyle?.display === 'grid',
    display,
    direction: style['flex-direction'] ?? 'column',
    faces,
  };
}

/** The outcome of checking one typed value. */
export type CheckedValue = { ok: true; patch: StylePatch; note?: string } | { ok: false; reason: string };

/**
 * Checks a typed value for `property` on the element at `path`. An empty
 * value removes the declaration.
 */
export function checkDeclaration(slide: Slide, path: NodePath, property: CssProperty, raw: string, faces: ReadonlySet<string>): CheckedValue {
  const value = raw.trim();
  if (value === '') return { ok: true, patch: { [property]: undefined } };
  const result = parseDeclaration(property, value, styleContextOf(slide, path, faces));
  if (!result.ok) return { ok: false, reason: result.noop ? `${property} has no effect here` : result.reason };
  const patch: StylePatch = {};
  for (const [name, v] of result.set) patch[name] = v;
  // A border shorthand replaces its sides.
  if (property === 'border') {
    patch['border-top'] = undefined;
    patch['border-right'] = undefined;
    patch['border-bottom'] = undefined;
    patch['border-left'] = undefined;
  }
  return { ok: true, patch, ...(result.warning || result.note ? { note: result.warning ?? result.note } : {}) };
}
