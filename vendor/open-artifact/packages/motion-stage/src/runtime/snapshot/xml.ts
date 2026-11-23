/*
 * A snapshot is XML, and one thing in it that XML cannot hold fails the whole picture, though HTML and the DOM accept
 * it: names left by a stray quote inside style="…", @click, <a:b>, a prefix nothing declares, "--" in a comment.
 * They draw nothing, so the copy drops them and renames such elements; what XML can hold stays as it is.
 */
const PLAIN_NAME = /^[A-Za-z_][-.\w]*$/;
const namesAsked = new Map<string, boolean>();

/**
 * XML holds a plain ASCII name, and none with any other ASCII character. The rest are put to this browser's own XML
 * parser and the answer kept: Firefox refuses many that XML allows.
 */
function xmlHoldsName(name: string): boolean {
  if (PLAIN_NAME.test(name)) return true;
  if (!/^[-.\w\u0080-\uffff]+$/.test(name)) return false;
  const known = namesAsked.get(name);
  if (known !== undefined) return known;
  if (namesAsked.size > 999) namesAsked.clear();
  const got = new DOMParser().parseFromString('<a ' + name + '=""/>', 'application/xml').documentElement.attributes;
  const holds = got.length === 1 && got[0]?.name === name;
  namesAsked.set(name, holds);
  return holds;
}

/**
 * An attribute a:b with no namespace does nothing on the stage, but XML reads a: as a prefix that must be declared,
 * and xmlns:… as a declaration, which may then be written twice. xml: needs no declaration. XML forbids xmlns:a="".
 */
function xmlHoldsAttribute(attribute: Attr): boolean {
  if (attribute.namespaceURI === null) return xmlHoldsName(attribute.name.replace(/^xml:/, ''));
  return (
    xmlHoldsName(attribute.localName) &&
    (!attribute.prefix || xmlHoldsName(attribute.prefix)) &&
    !(attribute.prefix === 'xmlns' && attribute.value === '')
  );
}

/**
 * XML cannot hold a control character other than tab, line feed and carriage return, U+FFFE, U+FFFF, or half a
 * surrogate pair.
 */
const NOT_IN_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/;
const SHOW_ELEMENTS_PIS_COMMENTS = 0x1 | 0x40 | 0x80;

// Everything is found before anything changes, so a throw while looking (a film may replace DOMParser) leaves the copy whole.
function leaveOutOfXml(root: Node): void {
  const attributes: Attr[] = [];
  const nodes: Node[] = [];
  const misnamed: Element[] = [];
  const find = (under: Node): void => {
    const walker = document.createTreeWalker(under, SHOW_ELEMENTS_PIS_COMMENTS);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Comment) {
        if (NOT_IN_XML.test(node.data) || /--|-$/.test(node.data)) nodes.push(node);
        continue;
      }
      if (node instanceof ProcessingInstruction) {
        if (NOT_IN_XML.test(node.data) || /^xml$/i.test(node.target) || !xmlHoldsName(node.target)) nodes.push(node);
        continue;
      }
      if (!(node instanceof Element)) continue;
      if (node instanceof HTMLTemplateElement) find(node.content);
      if (!xmlHoldsName(node.localName) || (node.prefix && !xmlHoldsName(node.prefix))) misnamed.push(node);
      if (!node.getAttributeNames().every((name) => PLAIN_NAME.test(name)))
        for (const attribute of node.attributes) if (!xmlHoldsAttribute(attribute)) attributes.push(attribute);
    }
  };
  find(root);
  for (const attribute of attributes) attribute.ownerElement?.removeAttributeNode(attribute);
  for (const node of nodes) node.parentNode?.removeChild(node);
  // An element the browser does not know draws the same under any unknown name; one with no hyphen, so no film can have defined it.
  for (const element of misnamed) {
    const renamed = document.createElementNS(element.namespaceURI, 'x_unnamed');
    while (element.attributes.length) {
      const first = element.attributes[0];
      if (first) renamed.setAttributeNode(element.removeAttributeNode(first));
    }
    while (element.firstChild) renamed.appendChild(element.firstChild);
    element.parentNode?.replaceChild(renamed, element);
  }
}

/**
 * The node as XML text. A form feed separates class names and CSS tokens, so it becomes a space; half a surrogate
 * pair becomes U+FFFD, as browsers draw it; other refused characters become U+2060, which draws nothing and keeps
 * apart what they kept apart.
 */
export function xmlOf(root: Node): string {
  try {
    leaveOutOfXml(root);
  } catch {
    // The copy goes out whole, and only its characters are mended.
  }
  let text = new XMLSerializer().serializeToString(root);
  if (NOT_IN_XML.test(text)) text = text.replace(/\u000c/g, ' ').replace(/[\u0000-\u0008\u000b\u000e-\u001f\ufffe\uffff]/g, '\u2060');
  return /[\ud800-\udfff]/.test(text)
    ? text.replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (found) => (found.length === 2 ? found : '\ufffd'))
    : text;
}
