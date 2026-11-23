/**
 * Inline `style` attributes: parse into ordered declarations and write them
 * back, keeping the order and spelling of declarations an edit did not touch.
 */

/** One `property: value` declaration. */
export interface StyleDeclaration {
  /** Property name, lower-case (custom properties keep their case). */
  property: string;
  value: string;
  important: boolean;
}

/** Splits text on a separator outside parentheses and quotes. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Parses an inline style. Malformed pieces are dropped. */
export function parseStyle(text: string): StyleDeclaration[] {
  const declarations: StyleDeclaration[] = [];
  for (const piece of splitTopLevel(text, ';')) {
    const colon = piece.indexOf(':');
    if (colon <= 0) continue;
    const rawProperty = piece.slice(0, colon).trim();
    if (!rawProperty) continue;
    let value = piece.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    const property = rawProperty.startsWith('--') ? rawProperty : rawProperty.toLowerCase();
    declarations.push({ property, value, important });
  }
  return declarations;
}

/** Writes declarations as `a: b; c: d`. */
export function serializeStyle(declarations: readonly StyleDeclaration[]): string {
  return declarations
    .map((declaration) => `${declaration.property}: ${declaration.value}${declaration.important ? ' !important' : ''}`)
    .join('; ');
}

/** Converts `fontSize` to `font-size`; kebab and custom names pass through. */
export function kebabCase(property: string): string {
  if (property.startsWith('--') || property.includes('-')) return property;
  return property.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/** Converts `font-size` to `fontSize` (React style keys); custom properties pass through. */
export function camelCase(property: string): string {
  if (property.startsWith('--')) return property;
  const name = property.startsWith('-ms-') ? property.slice(1) : property;
  return name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/** A style patch: a value sets, `null` removes. Keys may be kebab or camel case. */
export type StylePatch = Readonly<Record<string, string | null>>;

/**
 * Applies a patch: changed properties keep their position, new ones are
 * appended, removed ones disappear.
 */
export function patchStyle(text: string, patch: StylePatch): string {
  const declarations = parseStyle(text);
  for (const [key, value] of Object.entries(patch)) {
    const property = kebabCase(key);
    const index = declarations.findIndex((declaration) => declaration.property === property);
    if (value === null || value === '') {
      if (index >= 0) declarations.splice(index, 1);
    } else if (index >= 0) {
      declarations[index] = { property, value, important: declarations[index]!.important };
    } else {
      declarations.push({ property, value, important: false });
    }
  }
  return serializeStyle(declarations);
}

/** Reads a style into a plain map (kebab keys). Later declarations win. */
export function styleMap(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const declaration of parseStyle(text)) map[declaration.property] = declaration.value;
  return map;
}

/** Converts a style string to a React style object. */
export function toReactStyle(text: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const declaration of parseStyle(text)) {
    style[camelCase(declaration.property)] = declaration.important ? `${declaration.value} !important` : declaration.value;
  }
  return style;
}
