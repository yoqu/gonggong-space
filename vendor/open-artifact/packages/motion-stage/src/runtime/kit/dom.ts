export interface ElementProps {
  class?: string;
  style?: string | Record<string, string>;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  [property: string]: unknown;
}

/**
 * The element `html` makes, or for several roots a box-less parent holding them all: display:contents leaves
 * a flex or grid parent's layout alone, and a fragment would empty once appended. A trailing `<style>` is dropped.
 */
export function h(html: string): Element | null {
  const template = document.createElement('template');
  template.innerHTML = String(html).trim();
  const content = template.content;
  const drawn = [...content.children].filter((child) => !/^(style|script)$/i.test(child.tagName));
  if (content.childElementCount < 2 || (drawn.length < 2 && drawn[0] === content.firstElementChild)) return content.firstElementChild;
  const holder = document.createElement('div');
  holder.style.display = 'contents';
  holder.setAttribute('data-kit-holder', '');
  holder.appendChild(content);
  return holder;
}

export function el(tag: string, props: ElementProps | null = null, children: Array<Node | string | null | undefined> = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [name, rule] of Object.entries(value)) Reflect.set(node.style, name, rule);
    } else if (key === 'style') node.style.cssText = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'attrs' && typeof value === 'object') {
      for (const [name, attribute] of Object.entries(value)) node.setAttribute(name, String(attribute));
    } else Reflect.set(node, key, value);
  }
  for (const child of children ?? []) if (child !== null && child !== undefined) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

