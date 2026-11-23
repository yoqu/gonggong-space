/**
 * A small, strict XML parser and serializer, so drawn SVGs can be vetted
 * and restyled the same way in a page, a worker, the server or a test (no
 * `DOMParser`).
 *
 * It accepts well-formed XML 1.0 without a DTD: elements, attributes,
 * character and the five predefined entity references, comments, CDATA
 * sections and processing instructions (ignored). Namespaces are resolved
 * from `xmlns` declarations. Anything malformed throws {@link XmlParseError},
 * like a browser's parser reporting `parsererror`.
 *
 * The tree mirrors the slice of the DOM the drawn-SVG code needs
 * (`getAttribute`, `children`, `textContent`, `append`, `replaceWith`, …).
 */

import { SVG_NAMESPACE } from '../image-source.ts';

/** The `xml:` prefix namespace. */
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
/** The namespace of `xmlns` declarations. */
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
/** The XLink namespace (`xlink:href`). */
export const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

/** A malformed document. */
export class XmlParseError extends Error {
  /** Offset in the source where parsing failed. */
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message} at ${offset}`);
    this.name = 'XmlParseError';
    this.offset = offset;
  }
}

/** One attribute. */
export interface XmlAttribute {
  /** Qualified name (`xlink:href`). */
  readonly name: string;
  readonly prefix: string | undefined;
  readonly localName: string;
  readonly namespaceURI: string | null;
  value: string;
}

/** Any node of the tree. */
export type XmlNode = XmlElement | XmlText | XmlComment;

/** Shared tree operations of child nodes. */
abstract class XmlChildNode {
  /** The element this node is in. */
  parent: XmlElement | null = null;

  /** Removes this node from its parent. */
  remove(): void {
    const parent = this.parent;
    if (parent === null) return;
    const index = parent.childNodes.indexOf(this as unknown as XmlNode);
    if (index >= 0) parent.childNodes.splice(index, 1);
    this.parent = null;
  }

  /** Inserts nodes right after this one. */
  after(...nodes: XmlNode[]): void {
    const parent = this.parent;
    if (parent === null) return;
    let reference: XmlNode | null = parent.childNodes[parent.childNodes.indexOf(this as unknown as XmlNode) + 1] ?? null;
    for (const node of nodes) {
      parent.insertBefore(node, reference);
      reference = parent.childNodes[parent.childNodes.indexOf(node) + 1] ?? null;
    }
  }

  /** Replaces this node with others. */
  replaceWith(...nodes: XmlNode[]): void {
    const parent = this.parent;
    if (parent === null) return;
    this.after(...nodes.filter((node) => node !== (this as unknown as XmlNode)));
    if (!nodes.includes(this as unknown as XmlNode)) this.remove();
  }
}

/** Character data (text or a CDATA section). */
export class XmlText extends XmlChildNode {
  readonly nodeType = 3;
  data: string;
  /** Came from (and is written back as) a CDATA section. */
  readonly cdata: boolean;
  constructor(data: string, cdata = false) {
    super();
    this.data = data;
    this.cdata = cdata;
  }
}

/** A comment. */
export class XmlComment extends XmlChildNode {
  readonly nodeType = 8;
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
}

/** An element. */
export class XmlElement extends XmlChildNode {
  readonly nodeType = 1;
  /** Qualified name. */
  readonly name: string;
  readonly prefix: string | undefined;
  readonly localName: string;
  readonly namespaceURI: string | null;
  readonly attributes: XmlAttribute[] = [];
  readonly childNodes: XmlNode[] = [];

  constructor(name: string, namespaceURI: string | null) {
    super();
    const split = splitQualifiedName(name);
    this.name = name;
    this.prefix = split.prefix;
    this.localName = split.localName;
    this.namespaceURI = namespaceURI;
  }

  /** The child elements. */
  get children(): XmlElement[] {
    return this.childNodes.filter((node): node is XmlElement => node instanceof XmlElement);
  }

  /** How many child elements there are. */
  get childElementCount(): number {
    return this.children.length;
  }

  /** The text of every descendant text node, in order. */
  get textContent(): string {
    return this.childNodes.map((node) => (node instanceof XmlText ? node.data : node instanceof XmlElement ? node.textContent : '')).join('');
  }

  /** An attribute's value by qualified name, or `null`. */
  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  /** True when the element has the attribute. */
  hasAttribute(name: string): boolean {
    return this.attributes.some((attribute) => attribute.name === name);
  }

  /** Sets (or adds) an attribute by qualified name. */
  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    const { prefix, localName } = splitQualifiedName(name);
    const namespaceURI = name === 'xmlns' || prefix === 'xmlns' ? XMLNS_NAMESPACE : prefix === undefined ? null : (this.lookupNamespaceURI(prefix) ?? null);
    this.attributes.push({ name, prefix, localName, namespaceURI, value });
  }

  /** Removes an attribute by qualified name. */
  removeAttribute(name: string): void {
    const index = this.attributes.findIndex((attribute) => attribute.name === name);
    if (index >= 0) this.attributes.splice(index, 1);
  }

  /** The namespace a prefix (or the default namespace, `undefined`) resolves to here. */
  lookupNamespaceURI(prefix: string | undefined): string | undefined {
    if (prefix === 'xml') return XML_NAMESPACE;
    if (prefix === 'xmlns') return XMLNS_NAMESPACE;
    for (let element: XmlElement | null = this; element !== null; element = element.parent) {
      const declaration = element.attributes.find((attribute) => (prefix === undefined ? attribute.name === 'xmlns' : attribute.prefix === 'xmlns' && attribute.localName === prefix));
      if (declaration) return declaration.value === '' ? undefined : declaration.value;
    }
    return undefined;
  }

  /** Inserts a node before `reference` (at the end when `null`), moving it from where it was. */
  insertBefore<T extends XmlNode>(node: T, reference: XmlNode | null): T {
    if (node === reference) return node;
    node.remove();
    const index = reference === null ? -1 : this.childNodes.indexOf(reference);
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    node.parent = this;
    return node;
  }

  /** Appends a node, moving it from where it was. */
  appendChild<T extends XmlNode>(node: T): T {
    return this.insertBefore(node, null);
  }

  /** Appends nodes, moving them from where they were. */
  append(...nodes: XmlNode[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  /** Every descendant element, in document order (like `querySelectorAll('*')`). */
  descendants(): XmlElement[] {
    const found: XmlElement[] = [];
    const walk = (element: XmlElement): void => {
      for (const child of element.childNodes)
        if (child instanceof XmlElement) {
          found.push(child);
          walk(child);
        }
    };
    walk(this);
    return found;
  }
}

/** Splits `prefix:local`. */
function splitQualifiedName(name: string): { prefix: string | undefined; localName: string } {
  const colon = name.indexOf(':');
  return colon < 0 ? { prefix: undefined, localName: name } : { prefix: name.slice(0, colon), localName: name.slice(colon + 1) };
}

/** A new, empty SVG-namespace element (unprefixed). */
export function createSvgElement(localName: string): XmlElement {
  return new XmlElement(localName, SVG_NAMESPACE);
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

const NAME_START = 'A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD';
const NAME_CHAR = `${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;
/** An XML name without colons (an NCName). */
const NC_NAME = `[${NAME_START}][${NAME_CHAR}]*`;
/** A qualified name: `ncname` or `prefix:ncname`. */
const QUALIFIED_NAME_PATTERN = new RegExp(`${NC_NAME}(?::${NC_NAME})?`, 'y');
const WHITESPACE_PATTERN = /[ \t\r\n]*/y;
/** Characters XML 1.0 forbids anywhere. */
const INVALID_CHAR_PATTERN = /[\0-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function isValidCodePoint(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

/** Decodes entity and character references; throws on unknown or malformed ones. */
function decodeReferences(text: string, offset: number): string {
  if (!text.includes('&')) return text;
  return text.replace(/&([^;&]*)(;?)/g, (whole: string, body: string, semicolon: string, at: number) => {
    if (semicolon !== ';') throw new XmlParseError('Unterminated reference', offset + at);
    const numeric = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
    if (numeric) {
      const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : parseInt(numeric[2]!, 10);
      if (!isValidCodePoint(code)) throw new XmlParseError('Invalid character reference', offset + at);
      return String.fromCodePoint(code);
    }
    const entity = PREDEFINED_ENTITIES[body];
    if (entity === undefined) throw new XmlParseError(`Unknown entity ${whole}`, offset + at);
    return entity;
  });
}

/** An element being parsed, before its namespace is known. */
interface PendingElement {
  name: string;
  attributes: Array<{ name: string; value: string }>;
  start: number;
}

/**
 * Parses an XML document and returns its root element. Throws
 * {@link XmlParseError} when the document is not well-formed (or has a
 * DTD).
 */
export function parseXml(source: string): XmlElement {
  if (INVALID_CHAR_PATTERN.test(source)) throw new XmlParseError('Invalid character', source.search(INVALID_CHAR_PATTERN));
  let index = 0;
  let root: XmlElement | undefined;
  const stack: XmlElement[] = [];

  const fail = (message: string): never => {
    throw new XmlParseError(message, index);
  };
  const skipWhitespace = (): void => {
    WHITESPACE_PATTERN.lastIndex = index;
    WHITESPACE_PATTERN.exec(source);
    index = WHITESPACE_PATTERN.lastIndex;
  };
  const readName = (): string => {
    QUALIFIED_NAME_PATTERN.lastIndex = index;
    const match = QUALIFIED_NAME_PATTERN.exec(source);
    if (match === null) return fail('Expected a name');
    index = QUALIFIED_NAME_PATTERN.lastIndex;
    return match[0];
  };
  const expect = (text: string): void => {
    if (!source.startsWith(text, index)) fail(`Expected ${JSON.stringify(text)}`);
    index += text.length;
  };
  const addNode = (node: XmlNode): void => {
    const parent = stack[stack.length - 1];
    if (parent) parent.appendChild(node);
    else if (node instanceof XmlText) {
      if (!/^[ \t\r\n]*$/.test(node.data) || node.cdata) fail('Text outside the root element');
    } else if (node instanceof XmlElement) {
      if (root !== undefined) fail('More than one root element');
      root = node;
    }
  };

  // An optional XML declaration, only at the very start.
  if (/^<\?xml[ \t\r\n]/.test(source)) {
    const end = source.indexOf('?>');
    if (end < 0) fail('Unterminated XML declaration');
    index = end + 2;
  }

  while (index < source.length) {
    if (source[index] !== '<') {
      const end = source.indexOf('<', index);
      const raw = source.slice(index, end < 0 ? source.length : end);
      if (raw.includes(']]>')) fail('"]]>" in text');
      const start = index;
      index = end < 0 ? source.length : end;
      addNode(new XmlText(decodeReferences(raw, start)));
      continue;
    }
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end < 0) fail('Unterminated comment');
      const data = source.slice(index + 4, end);
      if (data.includes('--') || data.endsWith('-')) fail('"--" in comment');
      index = end + 3;
      if (stack.length > 0) addNode(new XmlComment(data));
      continue;
    }
    if (source.startsWith('<![CDATA[', index)) {
      if (stack.length === 0) fail('CDATA outside the root element');
      const end = source.indexOf(']]>', index + 9);
      if (end < 0) fail('Unterminated CDATA section');
      addNode(new XmlText(source.slice(index + 9, end), true));
      index = end + 3;
      continue;
    }
    if (source.startsWith('<!', index)) fail('Document type declarations are not supported');
    if (source.startsWith('<?', index)) {
      index += 2;
      const target = readName();
      if (target.toLowerCase() === 'xml') fail('Misplaced XML declaration');
      const end = source.indexOf('?>', index);
      if (end < 0) fail('Unterminated processing instruction');
      index = end + 2;
      continue;
    }
    if (source.startsWith('</', index)) {
      index += 2;
      const name = readName();
      skipWhitespace();
      expect('>');
      const open = stack.pop();
      if (open === undefined || open.name !== name) fail(`Mismatched end tag </${name}>`);
      continue;
    }
    // A start tag.
    const pending: PendingElement = { name: '', attributes: [], start: index };
    index += 1;
    pending.name = readName();
    let selfClosing = false;
    for (;;) {
      const before = index;
      skipWhitespace();
      if (source.startsWith('/>', index)) {
        index += 2;
        selfClosing = true;
        break;
      }
      if (source[index] === '>') {
        index += 1;
        break;
      }
      if (index === before) fail('Expected whitespace before an attribute');
      const name = readName();
      skipWhitespace();
      expect('=');
      skipWhitespace();
      const quote = source[index];
      if (quote !== '"' && quote !== "'") fail('Expected a quoted attribute value');
      const end = source.indexOf(quote!, index + 1);
      if (end < 0) fail('Unterminated attribute value');
      const raw = source.slice(index + 1, end);
      if (raw.includes('<')) fail('"<" in an attribute value');
      if (pending.attributes.some((attribute) => attribute.name === name)) fail(`Duplicate attribute ${name}`);
      // Attribute-value normalization: literal whitespace characters become spaces.
      pending.attributes.push({ name, value: decodeReferences(raw.replace(/[\t\n\r]/g, ' '), index + 1) });
      index = end + 1;
    }
    const element = resolveElement(pending, stack[stack.length - 1] ?? null);
    addNode(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length > 0) fail(`Unclosed element <${stack[stack.length - 1]!.name}>`);
  if (root === undefined) fail('No root element');
  return root!;
}

/** Builds an element from a start tag, resolving its namespaces against its parent. */
function resolveElement(pending: PendingElement, parent: XmlElement | null): XmlElement {
  // Declarations first, so the element's own prefixes resolve.
  const declared = new Map<string | undefined, string>();
  for (const attribute of pending.attributes) {
    const { prefix, localName } = splitQualifiedName(attribute.name);
    if (attribute.name === 'xmlns') declared.set(undefined, attribute.value);
    else if (prefix === 'xmlns') {
      if (attribute.value === '' || localName === 'xmlns' || (localName === 'xml') !== (attribute.value === XML_NAMESPACE)) throw new XmlParseError(`Bad namespace declaration ${attribute.name}`, pending.start);
      declared.set(localName, attribute.value);
    }
  }
  const lookup = (prefix: string | undefined): string | undefined => {
    if (declared.has(prefix)) return declared.get(prefix) || undefined;
    return parent?.lookupNamespaceURI(prefix) ?? (prefix === 'xml' ? XML_NAMESPACE : undefined);
  };
  const { prefix } = splitQualifiedName(pending.name);
  if (prefix === 'xmlns') throw new XmlParseError('Element named with the xmlns prefix', pending.start);
  const namespace = lookup(prefix);
  if (prefix !== undefined && namespace === undefined) throw new XmlParseError(`Unbound prefix ${prefix}`, pending.start);
  const element = new XmlElement(pending.name, namespace ?? null);
  element.parent = parent; // Temporarily, so lookups through `element` see the ancestors.
  const seen = new Set<string>();
  for (const attribute of pending.attributes) {
    const split = splitQualifiedName(attribute.name);
    const isDeclaration = attribute.name === 'xmlns' || split.prefix === 'xmlns';
    const attributeNamespace = isDeclaration ? XMLNS_NAMESPACE : split.prefix === undefined ? null : (lookup(split.prefix) ?? null);
    if (!isDeclaration && split.prefix !== undefined && attributeNamespace === null) throw new XmlParseError(`Unbound prefix ${split.prefix}`, pending.start);
    const expanded = `${attributeNamespace ?? ''}|${split.localName}`;
    if (attributeNamespace !== null && seen.has(expanded)) throw new XmlParseError(`Duplicate attribute ${attribute.name}`, pending.start);
    seen.add(expanded);
    element.attributes.push({ name: attribute.name, prefix: split.prefix, localName: split.localName, namespaceURI: attributeNamespace, value: attribute.value });
  }
  element.parent = null;
  return element;
}

/* -------------------------------------------------------------------------- */
/* Serializing                                                                 */
/* -------------------------------------------------------------------------- */

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
}

/**
 * The markup of a node. Elements without children self-close; namespace
 * declarations are written as they are in the tree (elements created with
 * {@link createSvgElement} inherit the root's default namespace).
 */
export function serializeXml(node: XmlNode): string {
  if (node instanceof XmlText) return node.cdata ? `<![CDATA[${node.data}]]>` : escapeText(node.data);
  if (node instanceof XmlComment) return `<!--${node.data}-->`;
  const attributes = node.attributes.map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
  return node.childNodes.length === 0 ? `<${node.name}${attributes}/>` : `<${node.name}${attributes}>${node.childNodes.map(serializeXml).join('')}</${node.name}>`;
}

/* -------------------------------------------------------------------------- */
/* SVG documents                                                               */
/* -------------------------------------------------------------------------- */

/** Why an SVG could not be read: `unread` (refused before parsing), `broken` (not well-formed, or not an SVG root). */
export type SvgReadFailure = 'unread' | 'broken';

/**
 * Parses an SVG drawing into a tree. Refuses (`unread`) DTDs, processing
 * instructions, more than three namespace declarations and any namespace
 * other than SVG and XLink; `broken` when the XML is malformed or the root
 * is not an SVG `<svg>`.
 */
export function parseSvgTree(svg: string): XmlElement | SvgReadFailure {
  const body = svg.replace(/^<\?xml version=(["'])1\.0\1(?: encoding=(["'])[Uu][Tt][Ff]-8\2)?(?: standalone=(["'])(?:yes|no)\3)?[ \t\r\n]*\?>/, '');
  if (/<!(?!--|\[CDATA\[)|<\?/.test(body) || body.split('xmlns').length > 4) return 'unread';
  if ([...body.matchAll(/xmlns(?::[^\s=]*)?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].some(([, doubleQuoted, singleQuoted]) => (doubleQuoted ?? singleQuoted) !== SVG_NAMESPACE && (doubleQuoted ?? singleQuoted) !== XLINK_NAMESPACE))
    return 'unread';
  try {
    const root = parseXml(body);
    return root.localName === 'svg' && root.namespaceURI === SVG_NAMESPACE ? root : 'broken';
  } catch (error) {
    if (error instanceof XmlParseError) return 'broken';
    throw error;
  }
}
