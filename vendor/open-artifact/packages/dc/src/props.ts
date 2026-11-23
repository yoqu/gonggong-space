/**
 * `data-props`: the declaration of an artboard's tweakable props.
 *
 * Each key is a prop the logic class reads as `this.props.<key>`. An entry
 * with an `editor` becomes a control in the Tweaks panel; `default` seeds the
 * control (the class still falls back with `this.props.x ?? …`). The special
 * key `$preview` gives the preferred preview size.
 */

/** Which control edits a prop; `null` for callbacks and objects. */
export type PropEditor = 'text' | 'color' | 'int' | 'float' | 'range' | 'boolean' | 'enum' | null;

/** One prop declaration. */
export interface PropSpec {
  editor: PropEditor;
  default?: unknown;
  /** Documentation only. */
  tsType?: string;
  /** `enum`: the choices; `color`: 3–4 swatch hexes. */
  options?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Groups controls under a heading in the Tweaks panel. */
  section?: string;
  /** Optional label; defaults to the key. */
  label?: string;
}

/** The preferred preview size. */
export interface PreviewSize {
  width: number;
  height: number;
}

/** A whole `data-props` object. */
export interface PropsSpec {
  $preview?: PreviewSize;
  [key: string]: PropSpec | PreviewSize | undefined;
}

const EDITORS: ReadonlySet<string> = new Set(['text', 'color', 'int', 'float', 'range', 'boolean', 'enum']);

/** Result of {@link parseProps}. */
export type ParsePropsResult = { ok: true; props: PropsSpec } | { ok: false; error: string };

/** Parses and validates the (entity-decoded) JSON of a `data-props` attribute. */
export function parseProps(json: string): ParsePropsResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return { ok: false, error: `data-props is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'data-props must be a JSON object.' };
  }
  const props = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(props)) {
    if (key === '$preview') {
      const preview = entry as Partial<PreviewSize> | null;
      if (!preview || typeof preview.width !== 'number' || typeof preview.height !== 'number') {
        return { ok: false, error: '$preview must be {"width": number, "height": number}.' };
      }
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `data-props.${key} must be an object.` };
    }
    const editor = (entry as { editor?: unknown }).editor;
    if (editor !== null && editor !== undefined && (typeof editor !== 'string' || !EDITORS.has(editor))) {
      return { ok: false, error: `data-props.${key}.editor "${String(editor)}" is not a known editor.` };
    }
  }
  return { ok: true, props: props as PropsSpec };
}

/** The declared tweakable props (entries with a non-null editor), in declaration order. */
export function tweakEntries(props: PropsSpec | null): [string, PropSpec][] {
  if (!props) return [];
  return Object.entries(props).filter(
    (entry): entry is [string, PropSpec] => entry[0] !== '$preview' && Boolean(entry[1]) && (entry[1] as PropSpec).editor != null,
  );
}

/** Default values of every declared prop. */
export function defaultProps(props: PropsSpec | null): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(props ?? {})) {
    if (key === '$preview' || !entry || !('editor' in entry)) continue;
    if ('default' in entry) values[key] = entry.default;
  }
  return values;
}
