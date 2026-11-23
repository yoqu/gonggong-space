/**
 * Rich text between the model and a contentEditable element: runs are
 * written as the subset's inline tags, and whatever the browser produced
 * while typing (b/strong, i/em, u, font/span colors, links, line breaks,
 * stray divs) is read back into normalized runs and blocks.
 */

import {
  cleanMarks,
  countMarks,
  isSafeHref,
  LIMITS,
  LIST_LEVELS,
  normalizeRuns,
  parseColor,
  runsLength,
  sliceRuns,
  type ListNode,
  type Marks,
  type Run,
  type TextBlock,
  type TextNode,
} from '@open-artifact/slides-core';

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML of runs (marks nested href › color › b › i › u, `\n` as `<br>`). */
export function runsToHtml(runs: readonly Run[]): string {
  let html = '';
  for (const run of runs) {
    let inner = escape(run.text).replace(/\n/g, '<br>');
    const m = run.marks;
    if (m?.u) inner = `<u>${inner}</u>`;
    if (m?.i) inner = `<i>${inner}</i>`;
    if (m?.b) inner = `<b>${inner}</b>`;
    const span = [m?.color ? `color:${escape(m.color)}` : '', m?.regular && !m.b ? 'font-weight:400' : ''].filter(Boolean);
    if (span.length) inner = `<span style="${span.join(';')}">${inner}</span>`;
    if (m?.href) inner = `<a href="${escape(m.href)}">${inner}</a>`;
    html += inner;
  }
  // A trailing break needs a second one to show the empty line.
  if (runs.length && runs[runs.length - 1]!.text.endsWith('\n')) html += '<br>';
  return html || '<br>';
}

/** HTML of the items of a list. */
export function itemsToHtml(list: ListNode): string {
  // Nested items are typed into flat, each with its level (Tab / Shift+Tab move it).
  return list.items.map((item) => `<li${levelAttrs(item.level)}>${runsToHtml(item.runs)}</li>`).join('') || '<li><br></li>';
}

/** The attributes of a typed-into item at a nesting level. */
export function levelAttrs(level: number | undefined): string {
  return level ? ` data-level="${level}" style="--open-artifact-level:${level}"` : '';
}

/** The nesting level an item element carries (0–8). */
export function itemLevel(li: Element): number {
  const level = Number(li.getAttribute('data-level') ?? '0');
  return Number.isInteger(level) ? Math.max(0, Math.min(LIST_LEVELS - 1, level)) : 0;
}

/** Moves the items the caret or selection touches one level in (+1) or out (-1). */
export function indentItems(list: HTMLElement, by: 1 | -1): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const items = [...list.children].filter((c): c is HTMLElement => c.tagName === 'LI' && range.intersectsNode(c));
  if (items.length === 0) return false;
  for (const li of items) {
    const level = Math.max(0, Math.min(LIST_LEVELS - 1, itemLevel(li) + by));
    if (level === 0) {
      li.removeAttribute('data-level');
      li.style.removeProperty('--open-artifact-level');
    } else {
      li.setAttribute('data-level', String(level));
      li.style.setProperty('--open-artifact-level', String(level));
    }
  }
  return true;
}

/** HTML of a text box's blocks. */
export function blocksToHtml(blocks: readonly TextBlock[]): string {
  if (blocks.length === 0) return '<p><br></p>';
  return blocks
    .map((block) => (block.kind === 'text' ? `<${block.tag}>${runsToHtml(block.runs)}</${block.tag}>` : `<${block.tag}>${itemsToHtml(block)}</${block.tag}>`))
    .join('');
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE']);

/** The marks an element adds. */
function marksOf(el: HTMLElement, marks: Marks): Marks {
  const next: Marks = { ...marks };
  switch (el.tagName) {
    case 'B':
    case 'STRONG':
      next.b = true;
      delete next.regular;
      break;
    case 'I':
    case 'EM':
      next.i = true;
      break;
    case 'U':
      next.u = true;
      break;
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      if (isSafeHref(href)) next.href = href.trim();
      break;
    }
    case 'FONT': {
      const color = parseColor(el.getAttribute('color') ?? '');
      if (color) next.color = color;
      break;
    }
  }
  const style = el.style;
  if (style) {
    if (style.color) {
      const color = parseColor(style.color);
      if (color) next.color = color;
    }
    const weight = style.fontWeight;
    if (weight === 'bold' || Number(weight) >= 600) {
      next.b = true;
      delete next.regular;
    } else if (weight === 'normal' || Number(weight) === 400) {
      next.regular = true;
      delete next.b;
    } else if (weight && Number(weight) < 600) delete next.b;
    if (style.fontStyle === 'italic') next.i = true;
    else if (style.fontStyle === 'normal') delete next.i;
    if (/underline/.test(style.textDecoration || style.textDecorationLine || '')) next.u = true;
  }
  return next;
}

/** Reads the runs of an element; nested blocks become line breaks. */
export function readRuns(root: Node): Run[] {
  const runs: Run[] = [];
  const push = (text: string, marks: Marks): void => {
    if (text) runs.push({ text, ...(cleanMarks(marks) ? { marks: cleanMarks(marks)! } : {}) });
  };
  const newline = (): void => {
    const last = runs[runs.length - 1];
    if (last && !last.text.endsWith('\n')) runs.push({ text: '\n' });
  };
  const walk = (node: Node, marks: Marks): void => {
    node.childNodes.forEach((child, i) => {
      if (child.nodeType === Node.TEXT_NODE) {
        // Collapse the editor's non-breaking spaces into plain ones.
        push((child.textContent ?? '').replace(/ /g, ' ').replace(/​/g, ''), marks);
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      if (child.tagName === 'BR') {
        // The browser's placeholder break at the very end of a block is not a line.
        const isLast = i === node.childNodes.length - 1;
        if (!(isLast && node !== root && BLOCK_TAGS.has((node as HTMLElement).tagName))) runs.push({ text: '\n' });
        else if (isLast && node === root && runs.length && !runs[runs.length - 1]!.text.endsWith('\n')) {
          // A trailing <br> in the root is the placeholder too.
        }
        return;
      }
      if (BLOCK_TAGS.has(child.tagName)) {
        newline();
        walk(child, marksOf(child, marks));
        newline();
        return;
      }
      walk(child, marksOf(child, marks));
    });
  };
  walk(root, {});
  let out = normalizeRuns(runs);
  // Drop the line breaks that only separated blocks at the edges.
  while (out.length && out[0]!.text.startsWith('\n')) out = normalizeRuns([{ ...out[0]!, text: out[0]!.text.slice(1) }, ...out.slice(1)]);
  while (out.length && out[out.length - 1]!.text.endsWith('\n')) {
    const last = out[out.length - 1]!;
    out = normalizeRuns([...out.slice(0, -1), { ...last, text: last.text.slice(0, -1) }]);
  }
  return clampRuns(out);
}

/** Keeps runs within the per-element limits (characters and marks). */
export function clampRuns(runs: Run[]): Run[] {
  let out = runs;
  if (runsLength(out) > LIMITS.textChars) out = sliceRuns(out, 0, LIMITS.textChars);
  while (countMarks(out) > LIMITS.inlineMarks && out.some((r) => r.marks)) {
    // Drop marks from the last marked run until the count fits.
    const i = out.map((r) => Boolean(r.marks)).lastIndexOf(true);
    out = normalizeRuns(out.map((r, j) => (j === i ? { text: r.text } : r)));
  }
  return out;
}

/** Reads list items from a `<ul>` / `<ol>` element. */
export function readItems(el: HTMLElement): ListNode['items'] {
  const items = [...el.children].filter((c) => c.tagName === 'LI').map((li) => {
    const level = itemLevel(li);
    return level ? { runs: readRuns(li as HTMLElement), level } : { runs: readRuns(li as HTMLElement) };
  });
  return items.length ? items : [{ runs: readRuns(el) }];
}

/** Reads a text box's blocks from its element. */
export function readBlocks(el: HTMLElement, previous: readonly TextBlock[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  let loose: Node[] = [];
  const flushLoose = (): void => {
    if (loose.length === 0) return;
    const holder = document.createElement('p');
    for (const node of loose) holder.appendChild(node.cloneNode(true));
    const runs = readRuns(holder);
    if (runs.length || blocks.length === 0) blocks.push({ kind: 'text', tag: 'p', style: {}, runs });
    loose = [];
  };
  el.childNodes.forEach((child) => {
    if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) {
      flushLoose();
      blocks.push({ kind: 'list', tag: child.tagName === 'UL' ? 'ul' : 'ol', style: {}, items: readItems(child) });
      return;
    }
    if (child instanceof HTMLElement && BLOCK_TAGS.has(child.tagName)) {
      flushLoose();
      const tag = /^H[1-3]$/.test(child.tagName) ? (child.tagName.toLowerCase() as TextNode['tag']) : 'p';
      blocks.push({ kind: 'text', tag, style: {}, runs: readRuns(child) });
      return;
    }
    loose.push(child);
  });
  flushLoose();
  // Keep the style of blocks that are still in their place, and a list's markers while its kind stays.
  return blocks.map((block, i) => {
    const before = previous[i];
    if (!before || before.kind !== block.kind) return block;
    if (before.kind === 'list' && block.kind === 'list' && before.tag === block.tag) return { ...before, items: block.items };
    return { ...block, style: before.style } as TextBlock;
  });
}
