/**
 * Shared pieces of the properties panel: reading a style value across the
 * selection, committing a typed CSS value through the compiler's property
 * table, the deck's color swatches, the Text style menu and text contrast.
 *
 * Every style edit from the panel goes through {@link commitCss} (or a
 * patch built by the core's value formatters), so what is stored is always
 * a value the slide compiler accepts, spelled the canonical way.
 */

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  composite,
  contrastRatio,
  faceKey,
  familyList,
  LIMITS,
  type DeckFace,
  matchTextStyle,
  nodeAt,
  parseBackground,
  patchNodeStyle,
  rgbaToHex,
  setTextTag,
  textStyleDeclarations,
  toRgba,
  walkNodes,
  TEXT_STYLE_IDS,
  TEXT_STYLE_NAMES,
  TEXT_STYLES,
  type CssProperty,
  type NodePath,
  type Rgba,
  type Slide,
  type SlideNode,
  type StyleMap,
  type StylePatch,
  type TextNode,
  type TextStyleId,
} from '@open-artifact/slides-core';
import { toast, cn } from '@open-artifact/ui';
import { readableShade } from '../../lib/colorspace.ts';
import type { ContrastInfo } from './ColorField.tsx';
import { CommitInput, NumberInput } from './kit.tsx';
import { deckFaces, useDeck } from '../../state/deck.ts';
import { changeCurrent, editableEntry, updateSelection } from '../../services/commands.ts';
import { useView } from '../../state/view.ts';
import { matchSystemStyle, systemStyleById, systemStyleDeclarations, useDesignSystems } from '../../services/design-systems.ts';
import { checkDeclaration } from '../../lib/style.ts';

/** What the panel edits: the selected elements, or the slide itself (`[]`). */
export interface Target {
  slide: Slide;
  /** Selected paths; `[[]]` when the slide itself is the target. */
  paths: NodePath[];
  /** The nodes at `paths` (empty for the slide). */
  nodes: SlideNode[];
}

/** A value read across the selection. */
export interface Shared {
  /** The common value (undefined: not set anywhere). */
  value: string | undefined;
  /** The selection disagrees. */
  mixed: boolean;
}

/** Reads `property` across the target. */
export function sharedStyle(target: Target, property: CssProperty): Shared {
  const values = target.nodes.length ? target.nodes.map((n) => n.style[property]) : [target.slide.style[property]];
  const first = values[0];
  return { value: first, mixed: values.some((v) => v !== first) };
}

/** A px value as a number (null when not plain px). */
export function pxOf(value: string | undefined): number | null {
  if (value === '0') return 0;
  const m = value ? /^(-?[\d.]+)px$/.exec(value) : null;
  return m ? Number(m[1]) : null;
}

/** The deck's declared font families, lower-cased (as the property table matches them). */
export function useFaces(): ReadonlySet<string> {
  const faces = useDeck((s) => s.index.faces);
  return useMemo(() => new Set(Object.values(faces).map((f) => f.family.toLowerCase())), [faces]);
}

/** The deck's declared families now, lower-cased as the property table expects. */
function facesNow(): ReadonlySet<string> {
  return new Set(deckFaces(useDeck.getState().index).map((f) => f.toLowerCase()));
}

/**
 * Checks `raw` for `property` on every target path and applies the result
 * as one undo step. A value the compiler refuses is reported, not written.
 */
export function commitCss(target: Target, property: CssProperty, raw: string, label: string = property, coalesce?: string): boolean {
  const faces = facesNow();
  const patches: Array<[NodePath, StylePatch]> = [];
  for (const path of target.paths) {
    const checked = checkDeclaration(target.slide, path, property, raw, faces);
    if (!checked.ok) {
      toast.add({ title: `Can't set ${property}`, description: checked.reason });
      return false;
    }
    if (checked.note) toast.add({ title: checked.note });
    patches.push([path, checked.patch]);
  }
  return applyPatches(label, patches, coalesce);
}

/** Applies a patch to every target path as one undo step (no checking). */
export function patchTarget(target: Target, label: string, patch: StylePatch | ((node: SlideNode | null) => StylePatch), coalesce?: string): boolean {
  return applyPatches(
    label,
    target.paths.map((path) => [path, typeof patch === 'function' ? patch(path.length ? (nodeAt(target.slide, path) ?? null) : null) : patch]),
    coalesce,
  );
}

function applyPatches(label: string, patches: ReadonlyArray<readonly [NodePath, StylePatch]>, coalesce?: string): boolean {
  return changeCurrent(
    label,
    (slide) => {
      let next = slide;
      for (const [path, patch] of patches) {
        if (path.length && !nodeAt(next, path)) continue;
        next = patchNodeStyle(next, path, patch);
      }
      return next;
    },
    coalesce ? { coalesce } : {},
  );
}

/* -------------------------------------------------------------------------- */
/* Fonts                                                                       */
/* -------------------------------------------------------------------------- */

/** Why a web font cannot be added: the deck carries as many as it may. */
export const FACE_LIMIT_REASON = `A presentation carries up to ${LIMITS.faces} typefaces, and every one is in use`;

/** Families any slide of the deck names, lower-cased. */
function usedFamilies(): Set<string> {
  const used = new Set<string>();
  const add = (value: string | undefined): void => {
    for (const name of familyList(value ?? '')) used.add(name.toLowerCase());
  };
  for (const entry of Object.values(useDeck.getState().slides)) {
    add(entry.slide.style['font-family']);
    walkNodes(entry.slide, (node) => add(node.style['font-family']));
  }
  return used;
}

/**
 * The deck's faces with `face` added, dropping faces no slide uses when the
 * deck is full; null when every carried face is in use.
 */
function carryFace(faces: Record<string, DeckFace>, face: DeckFace): Record<string, DeckFace> | null {
  const list = Object.entries(faces);
  if (list.some(([, f]) => f.family.toLowerCase() === face.family.toLowerCase())) return faces;
  let kept = list;
  if (kept.length >= LIMITS.faces) {
    const used = usedFamilies();
    kept = list.filter(([, f]) => used.has(f.family.toLowerCase()));
    if (kept.length >= LIMITS.faces) return null;
  }
  return { ...Object.fromEntries(kept), [faceKey(face.family)]: face };
}

/** True when the deck can take another web font (possibly by dropping an unused one). */
export function canCarryFace(): boolean {
  return carryFace(useDeck.getState().index.faces, { family: '\u0000' }) !== null;
}

/**
 * Sets `font-family` to `css` on every target path; with `face`, the deck
 * also starts carrying that web font, in the same undo step.
 */
export function commitFontFamily(target: Target, css: string, face: DeckFace | null): boolean {
  const state = useDeck.getState();
  const faces = face ? carryFace(state.index.faces, face) : state.index.faces;
  if (!faces) {
    toast.add({ title: `Can't add ${face!.family}`, description: FACE_LIMIT_REASON });
    return false;
  }
  if (faces === state.index.faces) return commitCss(target, 'font-family', css, 'Font');
  const id = useView.getState().current;
  const entry = editableEntry(id);
  if (!id || !entry) return false;
  const declared = new Set(Object.values(faces).map((f) => f.family.toLowerCase()));
  let slide = entry.slide;
  for (const path of target.paths) {
    const checked = checkDeclaration(slide, path, 'font-family', css, declared);
    if (!checked.ok) {
      toast.add({ title: "Can't set font-family", description: checked.reason });
      return false;
    }
    if (path.length && !nodeAt(slide, path)) continue;
    slide = patchNodeStyle(slide, path, checked.patch);
  }
  state.apply('Font', { slides: { [id]: slide }, index: { ...state.index, faces } }, { focus: id });
  return true;
}

/** A raw CSS value field for one property (Enter commits, empty removes). */
export function CssField({ target, property, label, placeholder, className }: { target: Target; property: CssProperty; label?: string; placeholder?: string; className?: string }): ReactNode {
  const shared = sharedStyle(target, property);
  return (
    <CommitInput
      aria-label={label ?? property}
      className={cn('min-w-0 flex-1 font-mono text-xs', className)}
      value={shared.mixed ? '' : (shared.value ?? '')}
      placeholder={shared.mixed ? 'Mixed' : (placeholder ?? '—')}
      onCommit={(value) => commitCss(target, property, value, label ?? property)}
    />
  );
}

/** A px number field for one property. */
export function PxField({
  target,
  property,
  label,
  min,
  max,
  step,
  placeholder,
  className,
}: {
  target: Target;
  property: CssProperty;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
}): ReactNode {
  const shared = sharedStyle(target, property);
  return (
    <NumberInput
      aria-label={label}
      className={className ?? 'w-full'}
      value={shared.mixed ? null : pxOf(shared.value)}
      unit="px"
      {...(min !== undefined ? { min } : {})}
      {...(max !== undefined ? { max } : {})}
      {...(step !== undefined ? { step } : {})}
      placeholder={shared.mixed ? 'Mixed' : (placeholder ?? (shared.value && pxOf(shared.value) === null ? shared.value : 'Auto'))}
      onCommit={(value) => commitCss(target, property, value === null ? '' : `${value}px`, label)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Text style menu                                                             */
/* -------------------------------------------------------------------------- */

/** One entry of the Text style menu, previewed in its own weight and case. */
export interface TextStyleOption {
  value: string;
  label: string;
  /** The style's size, shown at the item's end. */
  hint?: string;
  group?: string;
  style?: CSSProperties;
}

/** The Text style menu of text elements: the built-in scale, then the installed systems' styles. */
export interface TextStyleMenu {
  options: TextStyleOption[];
  /** The style every element matches (null: custom or mixed). */
  value: string | null;
  /** The elements match different styles. */
  mixed: boolean;
  /** Applies a style to every selected text element. */
  apply(id: string): void;
}

/** How a style's label previews it (weight, case and family; never its size). */
function previewStyle(declarations: StyleMap): CSSProperties {
  return {
    fontWeight: declarations['font-weight'] as CSSProperties['fontWeight'],
    textTransform: declarations['text-transform'] as CSSProperties['textTransform'],
    fontFamily: declarations['font-family'],
    fontStyle: declarations['font-style'] as CSSProperties['fontStyle'],
  };
}

/** The Text style menu for `nodes` (shared by the format bar and the properties panel). */
export function useTextStyleMenu(nodes: TextNode | readonly TextNode[] | null): TextStyleMenu {
  const systems = useDesignSystems((s) => s.systems);
  const faces = useFaces();
  const options = useMemo(() => {
    const builtIn: TextStyleOption[] = TEXT_STYLE_IDS.map((id) => {
      const preset = TEXT_STYLES[id];
      return {
        value: id as string,
        label: TEXT_STYLE_NAMES[id],
        hint: String(preset.fontSize),
        style: { fontWeight: preset.fontWeight, textTransform: preset.uppercase ? 'uppercase' : undefined },
        ...(systems.length ? { group: 'Built-in' } : {}),
      };
    });
    const installed: TextStyleOption[] = systems.flatMap((system) =>
      system.styles.map((style) => ({
        value: style.id,
        label: `${style.group ? `${style.group} / ` : ''}${style.name}`,
        hint: style.declarations['font-size']?.replace(/px$/, ''),
        group: system.title,
        style: previewStyle(style.declarations),
      })),
    );
    return [...installed, ...builtIn];
  }, [systems]);
  const list = nodes === null ? [] : Array.isArray(nodes) ? (nodes as readonly TextNode[]) : [nodes as TextNode];
  const matches = list.map((node) => matchTextStyle(node.tag, node.style) ?? matchSystemStyle(systems, node.tag, node.style)?.id ?? null);
  const mixed = matches.some((m) => m !== matches[0]);
  const value = mixed ? null : (matches[0] ?? null);
  const apply = (id: string): void => {
    const system = systemStyleById(id);
    if (system) {
      const declarations = systemStyleDeclarations(system, faces);
      updateSelection('Text style', (n) => (n.kind === 'text' ? setTextTag(n, system.tag, declarations) : n));
      return;
    }
    if (!(TEXT_STYLE_IDS as readonly string[]).includes(id)) return;
    const builtIn = id as TextStyleId;
    updateSelection('Text style', (n) => (n.kind === 'text' ? setTextTag(n, TEXT_STYLES[builtIn].tag, textStyleDeclarations(builtIn)) : n));
  };
  return { options, value, mixed, apply };
}

/* -------------------------------------------------------------------------- */
/* Contrast                                                                    */
/* -------------------------------------------------------------------------- */

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** The flat color a background paints; `unknown` for a gradient or picture. */
function paintOf(background: string | undefined): Rgba | 'unknown' | null {
  if (!background) return null;
  const parsed = parseBackground(background);
  if (!parsed.ok) return null;
  if (parsed.value.gradient || parsed.value.image) return 'unknown';
  const rgba = parsed.value.color ? toRgba(parsed.value.color) : null;
  return rgba && rgba.a > 0 ? rgba : null;
}

/** What is behind the element at `path`, and what it is called; null when it is not one flat color. */
function groundAt(slide: Slide, path: NodePath, self: boolean): { color: Rgba; where: string } | null {
  const chain: Array<{ style: { background?: string }; where: string }> = [{ style: slide.style, where: 'the slide background' }];
  const last = self ? path.length : path.length - 1;
  for (let i = 1; i <= last; i++) {
    const node = nodeAt(slide, path.slice(0, i));
    if (node) chain.push({ style: node.style, where: i === path.length ? 'its fill' : 'the group fill' });
  }
  let color = WHITE;
  let where = 'white';
  for (const link of chain) {
    const paint = paintOf(link.style.background);
    if (paint === 'unknown') return null;
    if (paint) {
      color = composite(paint, color);
      where = link.where;
    }
  }
  return { color, where };
}

/** The text color and the background behind the element at `path`. */
export function colorsAt(slide: Slide, path: NodePath): { text: Rgba; background: Rgba } {
  const ground = groundAt(slide, path, true)?.color ?? WHITE;
  let text = BLACK;
  const chain: Array<{ color?: string }> = [slide.style];
  for (let i = 1; i <= path.length; i++) {
    const node = nodeAt(slide, path.slice(0, i));
    if (node) chain.push(node.style);
  }
  for (const style of chain) {
    const rgba = style.color ? toRgba(style.color) : null;
    if (rgba) text = rgba;
  }
  return { text: composite(text, ground), background: ground };
}

/**
 * How readable the text (or icon) color of the single element in `target`
 * is: its rendered color on the flat color behind it. Null when there is
 * nothing to judge: several elements, colored runs, a gradient or picture
 * fill, or a ground that is not one color.
 */
export function contrastFor(target: Target, options: { kind: 'text' | 'icon'; color?: string | null; size?: number; weight?: number }): ContrastInfo | null {
  if (target.nodes.length !== 1) return null;
  const path = target.paths[0]!;
  const node = target.nodes[0]!;
  if (node.style['background-clip'] === 'text') return null;
  if (node.kind === 'text' && node.runs.some((run) => run.marks?.color)) return null;
  const ground = groundAt(target.slide, path, node.kind !== 'icon');
  if (!ground) return null;
  const raw = options.color ? toRgba(options.color) : colorsAt(target.slide, path).text;
  if (!raw) return null;
  const text = composite(raw, ground.color);
  const size = options.size ?? pxOf(node.style['font-size']) ?? 0;
  const weight = options.weight ?? Number(node.style['font-weight'] ?? 400);
  const large = size >= 32 || (size >= 24 && weight >= 700);
  const need = options.kind === 'icon' || large ? 3 : 4.5;
  const ratio = contrastRatio(text, ground.color);
  return {
    ratio,
    target: need,
    text: rgbaToHex(text),
    ground: rgbaToHex(ground.color),
    where: ground.where,
    fix: ratio >= need ? null : readableShade(text, ground.color, need),
  };
}
