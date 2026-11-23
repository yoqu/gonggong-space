/**
 * Slide model → slide HTML.
 *
 * The serializer writes the same closed subset the compiler reads, in one
 * canonical spelling: two-space indentation, one element per line, attributes
 * in a fixed order and style declarations in `CSS_PROPERTIES` order. Writing a
 * slide the compiler just read therefore changes only spelling (never what is
 * seen), and writing it twice changes nothing — the property the project
 * check verifies as "round-trip stability".
 */

import { escapeAttribute } from '@open-artifact/dc/html';
import { formatItemMargin, formatStyle } from './css/properties.ts';
import type {
  BuildSpec,
  ConnectorNode,
  Coord,
  ImageNode,
  ListNode,
  Marks,
  NodeBase,
  Run,
  Slide,
  SlideNode,
  StyleMap,
  TableNode,
  TextBlock,
} from './model.ts';
import { SOURCE_MARK } from './limits.ts';
import { normalizeRuns } from './text.ts';

/** Escapes text content; keeps spaces the HTML parser would collapse. */
function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '&nbsp;');
}

/**
 * Text of one line of a run list: collapsible spaces at the line edges and
 * every space after another space are written as `&nbsp;` so they survive.
 */
function protectSpaces(html: string, atStart: boolean, atEnd: boolean): string {
  let out = html.replace(/ {2,}/g, (spaces) => ' ' + '&nbsp;'.repeat(spaces.length - 1));
  if (atStart && out.startsWith(' ')) out = `&nbsp;${out.slice(1)}`;
  if (atEnd && out.endsWith(' ')) out = `${out.slice(0, -1)}&nbsp;`;
  return out;
}

/** Wraps escaped text in the tags of its marks (`a` outermost, `u` innermost). */
function wrapMarks(html: string, marks: Marks | undefined, gradientText: boolean): string {
  if (!marks) return html;
  let out = html;
  if (marks.u) out = `<u>${out}</u>`;
  if (marks.i) out = `<i>${out}</i>`;
  if (marks.b) out = `<b>${out}</b>`;
  const span: string[] = [];
  if (marks.color) {
    span.push(`color:${escapeAttribute(marks.color)}`);
    // Inside gradient-clipped text a colored run must repaint its own fill.
    if (gradientText) span.push('-webkit-text-fill-color:currentcolor');
  }
  if (marks.regular && !marks.b) span.push('font-weight:400');
  if (span.length) out = `<span style="${span.join(';')}">${out}</span>`;
  if (marks.href) out = `<a href="${escapeAttribute(marks.href)}">${out}</a>`;
  return out;
}

/** Rich text → inline HTML (`\n` → `<br>`). */
export function serializeRuns(runs: readonly Run[], gradientText = false): string {
  // Split runs into lines so that edge spaces of each line can be protected.
  const lines: Run[][] = [[]];
  for (const run of normalizeRuns(runs)) {
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ text: part, marks: run.marks });
    });
  }
  return lines
    .map((line) =>
      line
        .map((run, i) => wrapMarks(protectSpaces(escapeText(run.text), i === 0, i === line.length - 1), run.marks, gradientText))
        .join(''),
    )
    .join('<br>');
}

/** ` style="…"` or nothing. */
function styleAttr(style: StyleMap): string {
  const text = formatStyle(style);
  return text ? ` style="${escapeAttribute(text)}"` : '';
}

function attr(name: string, value: string | number | undefined | boolean): string {
  if (value === undefined || value === false) return '';
  if (value === true) return ` ${name}`;
  return ` ${name}="${escapeAttribute(String(value))}"`;
}

function buildValue(build: BuildSpec): string {
  return [build.effect, build.order !== undefined ? String(build.order) : '', build.auto ? 'auto' : ''].filter(Boolean).join(' ');
}

/** `id`, builds and fit: the attributes every element node may carry. */
function commonAttrs(node: NodeBase): string {
  return (
    attr('id', node.id) +
    (node.buildIn ? attr('data-build-in', buildValue(node.buildIn)) : '') +
    (node.buildOut ? attr('data-build-out', buildValue(node.buildOut)) : '') +
    attr('data-fit', node.fit)
  );
}

function coord(value: Coord): string {
  const n = Math.round(value.value * 100) / 100;
  return value.unit === '%' ? `${n}%` : String(n);
}

/** True when a text node's own style clips a gradient to its glyphs. */
function isGradientText(style: StyleMap): boolean {
  return style['-webkit-text-fill-color'] === 'transparent';
}

/** Options of {@link serializeSlide}. */
export interface SerializeOptions {
  /**
   * Write each node's source place (`NodeBase.origin`) as `data-open-artifact-src`: the
   * form `patchSourceSlide` compares, never a file's.
   */
  marks?: boolean;
}

/** Serializes slides as indented lines. */
class Writer {
  readonly lines: string[] = [];
  private readonly marks: boolean;

  constructor(options: SerializeOptions = {}) {
    this.marks = options.marks === true;
  }

  /** The attributes every element node may carry, and its source place when asked. */
  private common(node: NodeBase): string {
    return commonAttrs(node) + (this.marks && node.origin !== undefined ? attr(SOURCE_MARK, node.origin) : '');
  }

  line(depth: number, text: string): void {
    this.lines.push('  '.repeat(depth) + text);
  }

  slide(slide: Slide): string {
    this.line(
      0,
      `<section${attr('id', slide.id)}${attr('data-section', slide.section)}${attr('data-transition', slide.transition)}${attr('hidden', slide.hidden)}${attr('data-flat', slide.flat)}${styleAttr(slide.style)}>`,
    );
    for (const child of slide.children) this.node(child, 1);
    if (slide.notes.trim()) {
      const notes = escapeText(slide.notes.trim()).replace(/\n/g, '\n    ');
      this.line(1, '<aside>');
      this.line(2, notes);
      this.line(1, '</aside>');
    }
    this.line(0, '</section>');
    return `${this.lines.join('\n')}\n`;
  }

  node(node: SlideNode, depth: number): void {
    switch (node.kind) {
      case 'text':
        this.line(depth, `<${node.tag}${this.common(node)}${styleAttr(node.style)}>${serializeRuns(node.runs, isGradientText(node.style))}</${node.tag}>`);
        return;
      case 'list':
        this.list(node, depth, `${this.common(node)}${attr('start', node.start)}${attr('reversed', node.reversed)}${styleAttr(node.style)}`);
        return;
      case 'textbox':
        this.line(depth, `<div${this.common(node)} data-text${node.indent !== undefined ? `="${node.indent}"` : ''}${styleAttr(node.style)}>`);
        for (const block of node.blocks) this.block(block, depth + 1, isGradientText(node.style));
        this.line(depth, '</div>');
        return;
      case 'box': {
        const open = `<div${this.common(node)}${attr('data-group', node.group)}${styleAttr(node.style)}>`;
        if (node.children.length === 0) {
          this.line(depth, `${open}</div>`);
          return;
        }
        this.line(depth, open);
        for (const child of node.children) this.node(child, depth + 1);
        this.line(depth, '</div>');
        return;
      }
      case 'image':
        this.line(depth, `<img${imageAttrs(node)}${this.common(node)}${styleAttr(node.style)}>`);
        return;
      case 'table':
        this.table(node, depth);
        return;
      case 'svg': {
        const extra = `${this.common(node)}${styleAttr(node.style)}`;
        const markup = node.markup.replace(/^<svg\b/i, (m) => m + extra);
        for (const [i, text] of markup.split('\n').entries()) this.lines.push(i === 0 ? '  '.repeat(depth) + text : text);
        return;
      }
      case 'shape':
        this.line(depth, `<x-shape${attr('kind', node.shape)}${this.common(node)}${styleAttr(node.style)}></x-shape>`);
        return;
      case 'icon':
        this.line(depth, `<x-icon${attr('name', node.name)}${this.common(node)}${styleAttr(node.style)}></x-icon>`);
        return;
      case 'connector':
        this.line(depth, `<x-connector${connectorAttrs(node)}${this.common(node)}${styleAttr(node.style)}></x-connector>`);
        return;
      case 'embed':
        // The page is kept byte for byte: it is opaque to the editor.
        this.lines.push(`${'  '.repeat(depth)}<x-embed${this.common(node)}${styleAttr(node.style)}>${node.html}</x-embed>`);
        return;
      case 'rule':
        this.line(depth, `<hr${this.common(node)}${styleAttr(node.style)}>`);
        return;
    }
  }

  /** An unstyled block inside a text box. */
  block(block: TextBlock, depth: number, gradientText: boolean): void {
    if (block.kind === 'text') this.line(depth, `<${block.tag}>${serializeRuns(block.runs, gradientText)}</${block.tag}>`);
    else this.list(block, depth, styleAttr(block.style), gradientText);
  }

  list(node: ListNode, depth: number, attrs: string, gradientText = isGradientText(node.style)): void {
    this.line(depth, `<${node.tag}${attrs}>`);
    this.items(node, 0, 0, depth + 1, gradientText);
    this.line(depth, `</${node.tag}>`);
  }

  /**
   * Writes the items from `start` that sit at `level` or further in, and
   * returns the index of the first one it did not write. An item followed by
   * items further in holds them as a nested list of the same tag; an item
   * more than one level past its list carries `data-indent`.
   */
  private items(node: ListNode, start: number, level: number, depth: number, gradientText: boolean): number {
    const levelOf = (i: number): number => node.items[i]?.level ?? 0;
    const spaced = node.itemMargin ? ` style="margin:${formatItemMargin(node.itemMargin)}"` : '';
    let i = start;
    while (i < node.items.length && levelOf(i) >= level) {
      const item = node.items[i]!;
      const own = levelOf(i);
      const open = `<li${own > level ? attr('data-indent', own - level) : ''}${spaced}>${serializeRuns(item.runs, gradientText)}`;
      if (i + 1 < node.items.length && levelOf(i + 1) > own) {
        this.line(depth, open);
        this.line(depth + 1, `<${node.tag}${styleAttr(node.levels?.[own + 1] ?? {})}>`);
        i = this.items(node, i + 1, own + 1, depth + 2, gradientText);
        this.line(depth + 1, `</${node.tag}>`);
        this.line(depth, '</li>');
      } else {
        this.line(depth, `${open}</li>`);
        i++;
      }
    }
    return i;
  }

  table(node: TableNode, depth: number): void {
    this.line(depth, `<table${this.common(node)}${styleAttr(node.style)}>`);
    for (const row of node.rows) {
      const cells = row.cells.map((cell) => `<${cell.tag}${styleAttr(cell.style)}>${serializeRuns(cell.runs)}</${cell.tag}>`).join('');
      this.line(depth + 1, `<tr${styleAttr(row.style)}>${cells}</tr>`);
    }
    this.line(depth, '</table>');
  }
}

/** The media attributes of an `<img>`. */
function imageAttrs(node: ImageNode): string {
  let out = attr('src', node.src) + attr('alt', node.alt);
  if (node.crop) out += attr('data-crop', `${round(node.crop.zoom)} ${round(node.crop.x)}% ${round(node.crop.y)}%`);
  const video = node.video;
  if (video) {
    if (video.src) {
      out += attr('data-video', video.src);
      if (video.sound) out += attr('data-video-sound', 'on');
      if (video.loop === false) out += attr('data-video-loop', 'off');
      if (video.startOnClick) out += attr('data-video-start', 'click');
      if (video.delay) out += attr('data-video-delay', video.delay);
    } else if (video.link) {
      out += attr(`data-video-${video.link.provider}`, video.link.id);
      if (video.link.start) out += attr('data-video-at', video.link.start);
    }
    if (video.still) out += attr('data-video-still', video.still);
  }
  return out;
}

function connectorAttrs(node: ConnectorNode): string {
  let out = '';
  if (node.points) {
    out += attr('x1', coord(node.points.x1)) + attr('y1', coord(node.points.y1)) + attr('x2', coord(node.points.x2)) + attr('y2', coord(node.points.y2));
  } else if (node.from && node.from !== 'tl') out += attr('from', node.from);
  const { headStart, headEnd } = node;
  if (headStart === 'none' && headEnd === 'filled') {
    // The default (head="end").
  } else if (headStart === 'filled' && headEnd === 'filled') out += attr('head', 'both');
  else if (headStart === 'none' && headEnd === 'none') out += attr('head', 'none');
  else {
    out += attr('head', 'none');
    if (headStart !== 'none') out += attr('head-start', headStart);
    if (headEnd !== 'none') out += attr('head-end', headEnd);
  }
  if (node.route !== 'straight') out += attr('route', node.route);
  return out;
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Writes a slide file. */
export function serializeSlide(slide: Slide, options: SerializeOptions = {}): string {
  return new Writer(options).slide(slide);
}

/** Writes one node (and its subtree) as HTML at depth 0: the clipboard and agent-context form. */
export function serializeNode(node: SlideNode, options: SerializeOptions = {}): string {
  const writer = new Writer(options);
  writer.node(node, 0);
  return writer.lines.join('\n');
}
