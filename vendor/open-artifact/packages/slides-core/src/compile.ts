/**
 * Slide HTML → slide model.
 *
 * The compiler reads one slide file (exactly one `<section>`) and reports what
 * it found at four levels, the contract that lets an agent write the format
 * and the editor keep it:
 *
 * - `error`       structure the editor cannot represent (unknown tag, over a
 *                 limit, malformed markup). The slide is *held*: shown as far
 *                 as it could be read, never edited or re-saved.
 * - `warning`     a repair that changes what is seen (a negative offset
 *                 clamped, an undeclared font dropped).
 * - `note`        an equivalent rewrite (`pt` → `px`, `class` ignored).
 * - `unsupported` a declaration or attribute outside the subset, dropped.
 * - `lint`        a layout estimate worth a look (never blocking).
 */

import { parseHtml, VOID_ELEMENTS, type HtmlElement, type HtmlNode } from '@open-artifact/dc/html';
import {
  isCssProperty,
  isMarginProperty,
  parseDeclaration,
  foldAliases,
  readItemMargin,
  splitDeclarations,
  type CssProperty,
  type ItemMarginRead,
  type ElementKind,
  type StyleContext,
} from './css/properties.ts';
import { contrastRatio, parseColor, toRgba, type Rgba } from './css/color.ts';
import { parseBackground } from './css/values.ts';
import { isIconName } from './icons.ts';
import { BLOB_PATTERN, ID_PATTERN, LIMITS, LIST_LEVELS, SLIDE_HEIGHT, SLIDE_WIDTH, SOURCE_MARK, TEXT_DEFAULTS } from './limits.ts';
import {
  BUILD_EFFECTS,
  CORNERS,
  FIT_MODES,
  HEAD_KINDS,
  ROUTES,
  SHAPE_KINDS,
  TRANSITIONS,
  VIDEO_PROVIDERS,
  emptySlide,
  isPinned,
  type BoxNode,
  type BuildEffect,
  type BuildSpec,
  type ConnectorNode,
  type Coord,
  type Corner,
  type Crop,
  type EmbedNode,
  type HeadKind,
  type IconNode,
  type ImageNode,
  type ItemMargin,
  type ListNode,
  type Marks,
  type NodeBase,
  type Route,
  type Run,
  type ShapeKind,
  type ShapeNode,
  type Slide,
  type SlideNode,
  type StyleMap,
  type SvgNode,
  type TableCell,
  type TableNode,
  type TableRow,
  type TextBlock,
  type TextBoxNode,
  type TextNode,
  type TextTag,
  type VideoSpec,
} from './model.ts';
import { countMarks, isSafeHref, normalizeRuns, runsLength } from './text.ts';
import { normalizeVideoLink, normalizeVideoStart } from './video.ts';

/** Severity of a diagnostic. */
export type DiagnosticLevel = 'error' | 'warning' | 'note' | 'unsupported' | 'lint';

/** One finding of the compiler. */
export interface Diagnostic {
  level: DiagnosticLevel;
  message: string;
  /** 1-based line of the element it is about. */
  line?: number;
  /** 1-based column. */
  column?: number;
}

/** Options of {@link compileSlide}. */
export interface CompileOptions {
  /** The slide id the file name implies; the section's `id` must equal it. */
  id?: string;
  /** Families the deck declares (deck.json `faces`); others heal away. */
  faces?: Iterable<string>;
  /** Skip layout lints (the editor compiles often and shows none). */
  lints?: boolean;
  /**
   * The file is a source slide as `readSourceSlide` worked it out: keep each
   * element's `data-open-artifact-src` place on its node (`NodeBase.origin`), keep
   * `margin` on pinned elements, and say nothing of the attributes the reader leaves behind.
   */
  source?: boolean;
}

/** What {@link compileSlide} returns. */
export interface CompileResult {
  /** The slide as far as it could be read (always present). */
  slide: Slide;
  /** True when an error holds the slide read-only. */
  held: boolean;
  diagnostics: Diagnostic[];
  /** Every `/_blob/<id>` and `project/ds/…` path the slide references. */
  assets: string[];
  /** Table cells on the slide (the deck limit adds these up). */
  cells: number;
}

/** Tags allowed as flow / pinned elements. */
const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'div', 'img', 'video', 'table', 'svg', 'hr',
  'x-shape', 'x-icon', 'x-connector', 'x-embed',
]);

/** Inline tags inside text. */
const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'span', 'br']);

/** Inline tags healed away (text kept). */
const SOFT_INLINE_TAGS = new Set(['code', 's', 'del', 'ins', 'mark', 'small', 'sup', 'sub', 'abbr', 'cite', 'q', 'kbd', 'time']);

/** Where a node sits, for the property table and the limits. */
interface Place {
  /** The parent is the section itself. */
  section: boolean;
  /** The parent's own layout. */
  parentDisplay: 'flex' | 'grid' | 'none';
  /** Nesting depth of `<div>`s so far. */
  depth: number;
  /** Inherited text color and nearest solid background (for the contrast lint). */
  color: Rgba | null;
  background: Rgba | null;
  /** Inherited font size (px) for estimates. */
  fontSize: number;
}

/** Line/column lookup for source offsets. */
class Lines {
  private readonly starts: number[] = [0];
  constructor(source: string) {
    for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  at(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.starts[lo]! + 1 };
  }
}

/** Raw attribute lookup (names lower-cased). */
function attrMap(el: HtmlElement): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const attr of el.attrs) map.set(attr.name.toLowerCase(), attr.value);
  return map;
}

/** Collapses HTML whitespace. */
function collapse(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, ' ');
}

/** Trims collapsible spaces at block edges and around line breaks. */
function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((run) => ({ ...run }));
  // Spaces after a line break and before one go away, as do block-edge spaces.
  for (let i = 0; i < out.length; i++) {
    const prevEndsBreak = i === 0 || out[i - 1]!.text.endsWith('\n');
    if (prevEndsBreak) out[i]!.text = out[i]!.text.replace(/^ +/, '');
    out[i]!.text = out[i]!.text.replace(/\n +/g, '\n').replace(/ +\n/g, '\n');
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const nextStartsBreak = i === out.length - 1 || out[i + 1]!.text.startsWith('\n');
    if (nextStartsBreak) out[i]!.text = out[i]!.text.replace(/ +$/, '');
    if (out[i]!.text) break;
  }
  // Collapse spaces across run boundaries ("a <b> b</b>" keeps one).
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1]!.text.endsWith(' ') && out[i]!.text.startsWith(' ')) out[i]!.text = out[i]!.text.slice(1);
  }
  return normalizeRuns(out);
}

/** The slide compiler for one file. */
class SlideCompiler {
  readonly diagnostics: Diagnostic[] = [];
  readonly assets = new Set<string>();
  private readonly lines: Lines;
  private readonly faces: ReadonlySet<string>;
  private readonly lintsOn: boolean;
  private elements = 0;
  cells = 0;
  private embeds = 0;
  private builds = 0;
  private readonly ids = new Set<string>();
  private label = 'slide: ';
  /** Pinned text boxes with a known rect, for the overlap lint. */
  private readonly pinnedText: Array<{ rect: [number, number, number, number]; at: HtmlElement }> = [];

  private readonly source: string;
  private readonly options: CompileOptions;

  constructor(source: string, options: CompileOptions) {
    this.source = source;
    this.options = options;
    this.lines = new Lines(source);
    this.faces = new Set([...(options.faces ?? [])].map((family) => family.toLowerCase()));
    this.lintsOn = options.lints !== false;
  }

  report(level: DiagnosticLevel, message: string, at?: HtmlNode): void {
    const pos = at && at.start >= 0 ? this.lines.at(at.start) : undefined;
    this.diagnostics.push({ level, message: this.label + message, ...(pos ?? {}) });
  }

  error(message: string, at?: HtmlNode): void {
    this.report('error', message, at);
  }

  warn(message: string, at?: HtmlNode): void {
    this.report('warning', message, at);
  }

  note(message: string, at?: HtmlNode): void {
    this.report('note', message, at);
  }

  unsupported(message: string, at?: HtmlNode): void {
    this.report('unsupported', message, at);
  }

  lint(message: string, at?: HtmlNode): void {
    if (this.lintsOn) this.report('lint', `layout: ${message}`, at);
  }

  /* ------------------------------------------------------------------------ */
  /* Document                                                                  */
  /* ------------------------------------------------------------------------ */

  compile(): Slide {
    const bytes = new TextEncoder().encode(this.source).length;
    if (bytes > LIMITS.slideFileBytes) {
      this.error(`the file is ${Math.round(bytes / 1024)} KB, over the 1 MB limit for one slide — shorten it or split it into two slides`);
    }
    const roots = parseHtml(this.source);
    this.checkClosed(roots);
    for (const { node, message } of misreadComments(roots)) this.warn(message, node);
    const sections: HtmlElement[] = [];
    for (const node of roots) {
      if (node.type === 'comment') continue;
      if (node.type === 'text') {
        if (node.value.trim()) this.error('text outside <section> — a slide file holds exactly one <section>', node);
        continue;
      }
      if (node.tag === 'section') {
        sections.push(node);
        continue;
      }
      if (node.tag === 'title' || node.tag === 'link' || node.tag === 'style' || node.tag === 'meta') {
        this.error(`<${node.tag}> does not belong in a slide file — the deck's title and fonts live in project/deck.json`, node);
        continue;
      }
      if (node.tag === 'html' || node.tag === 'head' || node.tag === 'body') {
        this.error(`<${node.tag}> does not belong in a slide file — write the <section> alone`, node);
        continue;
      }
      this.error(`<${node.tag}> outside <section> — a slide file holds exactly one <section>`, node);
    }
    if (sections.length === 0) {
      this.error('no <section> — a slide file holds exactly one <section id="…">');
      return emptySlide(this.options.id ?? 'slide');
    }
    if (sections.length > 1) this.error(`${sections.length} <section>s — a slide file holds exactly one; split the rest into their own files`, sections[1]);
    return this.section(sections[0]!);
  }

  /** Reports elements that are never closed (malformed markup). */
  private checkClosed(nodes: HtmlNode[]): void {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (!VOID_ELEMENTS.has(node.tag) && !node.selfClosing && node.closeStart < 0) {
        this.error(`<${node.tag}> is never closed (malformed markup)`, node);
      }
      if (node.tag !== 'svg' && node.tag !== 'x-embed') this.checkClosed(node.children);
    }
  }

  private section(el: HtmlElement): Slide {
    const attrs = attrMap(el);
    let id = attrs.get('id') ?? undefined;
    if (id !== undefined && !ID_PATTERN.test(id)) {
      this.error(`<section id="${id.slice(0, 40)}"> — an id is 1–64 letters, digits, _ or -`, el);
      id = undefined;
    }
    if (this.options.id !== undefined) {
      if (id === undefined) {
        this.warn(`<section> has no id; using "${this.options.id}" from the file name`, el);
        id = this.options.id;
      } else if (id !== this.options.id) {
        this.error(`<section id="${id}"> must equal its file name ("${this.options.id}.html")`, el);
      }
    } else if (id === undefined) {
      this.error('<section> needs an id', el);
    }
    const slide = emptySlide(id ?? this.options.id ?? 'slide');
    this.label = `slide "${slide.id}": `;
    for (const [name, value] of attrs) {
      switch (name) {
        case 'id':
        case 'style':
          break;
        case 'hidden':
          slide.hidden = true;
          break;
        case 'data-flat':
          slide.flat = true;
          break;
        case 'data-section': {
          const text = (value ?? '').trim();
          if (text.length > LIMITS.sectionDescription) this.warn(`data-section is over ${LIMITS.sectionDescription} characters; cut`, el);
          slide.section = text.slice(0, LIMITS.sectionDescription);
          break;
        }
        case 'data-transition': {
          const t = (value ?? '').trim().toLowerCase();
          if ((TRANSITIONS as readonly string[]).includes(t)) slide.transition = t as Slide['transition'];
          else if (t && t !== 'none') this.warn(`data-transition="${t}" — one of fade, push, magic; dropped`, el);
          break;
        }
        default:
          this.attribute(name, el, '<section>');
      }
    }
    const style = this.style(el, attrs.get('style') ?? '', {
      element: 'section',
      pinned: false,
      flowChild: false,
      gridChild: false,
    });
    slide.style = style;
    const place: Place = {
      section: true,
      parentDisplay: displayOf(style),
      depth: 0,
      color: rgba(style.color) ?? { r: 0, g: 0, b: 0, a: 1 },
      background: solidBackground(style) ?? { r: 255, g: 255, b: 255, a: 1 },
      fontSize: readPx(style['font-size']) ?? TEXT_DEFAULTS.p.fontSize,
    };
    const children = el.children;
    let asideSeen = false;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (child.type === 'element' && child.tag === 'aside') {
        if (asideSeen) this.warn('a second <aside> — one speaker-notes block per slide; joined', child);
        const rest = children.slice(i + 1).some((n) => n.type === 'element' || (n.type === 'text' && n.value.trim()));
        if (rest) this.note('<aside> (speaker notes) goes last; moved', child);
        const notes = this.notes(child);
        slide.notes = slide.notes ? `${slide.notes}\n\n${notes}` : notes;
        asideSeen = true;
        continue;
      }
    }
    slide.children = this.children(el.children.filter((n) => !(n.type === 'element' && n.tag === 'aside')), place);
    if (slide.notes.length > LIMITS.notes) {
      this.warn(`speaker notes are over ${LIMITS.notes} characters; cut`);
      slide.notes = slide.notes.slice(0, LIMITS.notes);
    }
    const pinned = slide.children.filter(isPinned).length;
    if (pinned > LIMITS.pinnedPerHost) this.error(`${pinned} positioned children in <section> — at most ${LIMITS.pinnedPerHost} per host; split them across position:relative <div>s`, el);
    if (this.elements > LIMITS.elementsHard) this.error(`${this.elements} elements — at most ${LIMITS.elementsHard} on one slide (split it)`, el);
    else if (this.elements > LIMITS.elements) this.warn(`${this.elements} elements — keep a slide to ${LIMITS.elements} (split it)`, el);
    if (this.cells > LIMITS.slideCells) this.error(`${this.cells} table cells — at most ${LIMITS.slideCells} on one slide`, el);
    if (this.builds > LIMITS.builds) this.error(`${this.builds} builds — at most ${LIMITS.builds} on one slide`, el);
    this.lintOverlaps();
    return slide;
  }

  /** Speaker notes: the plain text of `<aside>`, line breaks kept. */
  private notes(el: HtmlElement): string {
    const parts: string[] = [];
    const walk = (nodes: HtmlNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'text') parts.push(node.value);
        else if (node.type === 'element') {
          if (node.tag === 'br') parts.push('\n');
          else {
            if (node.tag === 'p' && parts.length) parts.push('\n');
            walk(node.children);
          }
        }
      }
    };
    walk(el.children);
    const hasMarkup = el.children.some((n) => n.type === 'element' && n.tag !== 'br' && n.tag !== 'p');
    if (hasMarkup) this.note('<aside> holds plain text; markup inside it was dropped', el);
    return parts
      .join('')
      .split('\n')
      .map((line) => line.replace(/[ \t\r\f]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** An attribute the element does not take. */
  private attribute(name: string, el: HtmlElement, tag: string): void {
    if (this.options.source && (name === SOURCE_MARK || name.startsWith('data-') || name.startsWith('aria-') || name === 'role')) return;
    if (name.startsWith('on')) this.warn(`${tag} ${name}= — event handlers never run here; dropped`, el);
    else if (name === 'class' || name.startsWith('data-') || name.startsWith('aria-') || name === 'role' || name === 'title' || name === 'lang' || name === 'dir') {
      this.note(`${tag} ${name}= is ignored`, el);
    } else this.unsupported(`${tag} ${name}= is not in the subset; dropped`, el);
  }

  /* ------------------------------------------------------------------------ */
  /* Styles                                                                    */
  /* ------------------------------------------------------------------------ */

  /** Parses one inline style against the property table. */
  style(el: HtmlElement, text: string, base: Omit<StyleContext, 'faces' | 'display' | 'direction'> & { shape?: ShapeKind }): StyleMap {
    const folded = foldAliases(splitDeclarations(text), base.element);
    const declarations = folded.declarations;
    const raw = new Map<string, string>();
    for (const [name, value] of declarations) raw.set(name.trim().toLowerCase(), value);
    const display = (raw.get('display') ?? '').trim().toLowerCase();
    const position = (raw.get('position') ?? '').trim().toLowerCase();
    const ctx: StyleContext = {
      ...base,
      pinned: base.pinned || position === 'absolute',
      faces: this.faces,
      pinnedMargins: this.options.source === true,
      display: display === 'grid' ? 'grid' : display === 'none' ? 'none' : 'flex',
      // As in CSS, an explicit `display:flex` runs in a row; a box with no `display` stacks.
      direction: (raw.get('flex-direction') ?? (display === 'flex' ? 'row' : 'column')).trim().toLowerCase(),
    };
    if (ctx.pinned) {
      ctx.flowChild = false;
      ctx.gridChild = false;
    }
    const style: StyleMap = {};
    const tag = describe(el);
    for (const note of new Set(folded.notes)) this.note(`${tag} ${note}`, el);
    for (const [name, value] of declarations) {
      const result = parseDeclaration(name, value, ctx);
      if (!result.ok) {
        if (!result.noop) this.unsupported(`${tag} ${result.reason}; dropped`, el);
        continue;
      }
      if (result.warning) this.warn(`${tag} ${result.warning}`, el);
      else if (result.note) this.note(`${tag} ${result.note}`, el);
      for (const [property, v] of result.set) {
        // A shorthand set later replaces its longhands set earlier, as in CSS.
        if (property === 'border') {
          delete style['border-top'];
          delete style['border-right'];
          delete style['border-bottom'];
          delete style['border-left'];
        }
        if (property === 'flex') {
          delete style['flex-grow'];
          delete style['flex-shrink'];
          delete style['flex-basis'];
        }
        style[property] = v;
      }
    }
    // `flex-direction` / `flex-wrap` / `justify-content` without `display` mean flex.
    if (style['display'] === undefined && style['flex-direction']?.startsWith('row') && (base.element === 'div' || base.element === 'section')) {
      style.display = 'flex';
      this.note(`${tag} flex-direction:row without display:flex → display:flex`, el);
    }
    // `display:flex` alone is a row (CSS's default). Boxes render as columns
    // unless told otherwise, so the row is written out for every renderer.
    if (style['display'] === 'flex' && style['flex-direction'] === undefined && (base.element === 'div' || base.element === 'section')) {
      style['flex-direction'] = 'row';
    }
    return style;
  }

  /* ------------------------------------------------------------------------ */
  /* Children                                                                  */
  /* ------------------------------------------------------------------------ */

  private children(nodes: HtmlNode[], place: Place): SlideNode[] {
    const out: SlideNode[] = [];
    let loose: HtmlNode[] = [];
    const flushLoose = (): void => {
      if (loose.length === 0) return;
      const text = loose.filter((n) => n.type === 'text' || (n.type === 'element' && INLINE_TAGS.has(n.tag)));
      if (text.some((n) => n.type === 'element' || (n.type === 'text' && n.value.trim()))) {
        const runs = trimRuns(this.inline(text, {}, loose[0] as HtmlElement));
        if (runsLength(runs) > 0) {
          this.warn('text directly in a container — wrapped in <p>', loose[0]);
          out.push({ kind: 'text', tag: 'p', style: {}, runs });
          this.elements++;
        }
      }
      loose = [];
    };
    for (const node of nodes) {
      if (node.type === 'comment') continue;
      if (node.type === 'text' || (node.type === 'element' && INLINE_TAGS.has(node.tag))) {
        loose.push(node);
        continue;
      }
      flushLoose();
      const compiled = this.element(node, place);
      if (compiled) out.push(compiled);
    }
    flushLoose();
    return out;
  }

  /** One block element. */
  private element(el: HtmlElement, place: Place): SlideNode | null {
    if (!BLOCK_TAGS.has(el.tag)) {
      if (el.tag === 'script') this.error('<script> is not allowed (scripts never run here)', el);
      else if (el.tag === 'aside') this.error('<aside> (speaker notes) belongs directly in <section>', el);
      else if (el.tag === 'li') this.error('<li> belongs in <ul> or <ol>', el);
      else if (el.tag === 'tr' || el.tag === 'td' || el.tag === 'th') this.error(`<${el.tag}> belongs in <table>`, el);
      else if (el.tag === 'iframe' || el.tag === 'canvas' || el.tag === 'object') this.error(`<${el.tag}> is not allowed — a live page goes in <x-embed>`, el);
      else if (el.tag === 'section') this.error('<section> inside a slide — one <section> per file', el);
      else if (/^h[4-6]$/.test(el.tag)) this.error(`<${el.tag}> is not in the subset — use <h3> or <p>`, el);
      else this.error(`<${el.tag}> is not in the subset (unknown or misplaced tag)`, el);
      return null;
    }
    this.elements++;
    const attrs = attrMap(el);
    switch (el.tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'p':
        return this.text(el, attrs, place);
      case 'ul':
      case 'ol':
        return this.list(el, attrs, place);
      case 'div':
        return attrs.has('data-text') ? this.textbox(el, attrs, place) : this.box(el, attrs, place);
      case 'img':
      case 'video':
        return this.image(el, attrs, place);
      case 'table':
        return this.table(el, attrs, place);
      case 'svg':
        return this.svg(el, attrs, place);
      case 'hr':
        return this.leaf<SlideNode>(el, attrs, place, 'hr', { kind: 'rule', style: {} });
      case 'x-shape':
        return this.shape(el, attrs, place);
      case 'x-icon':
        return this.icon(el, attrs, place);
      case 'x-connector':
        return this.connector(el, attrs, place);
      case 'x-embed':
        return this.embed(el, attrs, place);
    }
    return null;
  }

  /** Reads attributes common to element nodes; reports the rest. */
  private common(node: NodeBase, el: HtmlElement, attrs: Map<string, string | null>, place: Place, extra: readonly string[], pinned: boolean): void {
    const tag = describe(el);
    for (const [name, value] of attrs) {
      if (extra.includes(name)) continue;
      switch (name) {
        case 'style':
          break;
        case 'id': {
          const id = (value ?? '').trim();
          if (!ID_PATTERN.test(id)) this.warn(`${tag} id="${id.slice(0, 40)}" — 1–64 letters, digits, _ or -; dropped`, el);
          else if (this.ids.has(id)) this.warn(`${tag} id="${id}" is used twice on this slide; the second dropped`, el);
          else {
            this.ids.add(id);
            node.id = id;
          }
          break;
        }
        case 'data-build-in':
        case 'data-build-out': {
          if (!(pinned && place.section)) {
            this.warn(`${tag} ${name} — builds go on the slide's position:absolute children only; dropped`, el);
            break;
          }
          const build = this.build(value ?? '', el, name);
          if (build) {
            this.builds++;
            if (name === 'data-build-in') node.buildIn = build;
            else node.buildOut = build;
          }
          break;
        }
        case 'data-fit': {
          const fit = (value ?? '').trim().toLowerCase();
          if (!(FIT_MODES as readonly string[]).includes(fit)) this.warn(`${tag} data-fit="${fit}" — one of none, grow, shrink; dropped`, el);
          else if (fit !== 'shrink') node.fit = fit as 'none' | 'grow';
          break;
        }
        case SOURCE_MARK:
          if (this.options.source && value !== null && /^-?\d+$/.test(value)) node.origin = Number(value);
          else this.attribute(name, el, tag);
          break;
        default:
          this.attribute(name, el, tag);
      }
    }
  }

  /** `data-build-*="effect [order] [auto]"`. */
  private build(value: string, el: HtmlElement, name: string): BuildSpec | undefined {
    const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const effect = words[0];
    if (!effect || !(BUILD_EFFECTS as readonly string[]).includes(effect)) {
      this.warn(`${name}="${value}" — the effect is one of ${BUILD_EFFECTS.join(', ')}; dropped`, el);
      return undefined;
    }
    const spec: BuildSpec = { effect: effect as BuildEffect };
    for (const word of words.slice(1)) {
      if (word === 'auto') spec.auto = true;
      else if (/^\d+$/.test(word) && Number(word) >= 1 && Number(word) <= LIMITS.buildOrder) spec.order = Number(word);
      else this.warn(`${name}="${value}" — "${word}" is not an order 1–${LIMITS.buildOrder} or auto; ignored`, el);
    }
    return spec;
  }

  /** Style context fields of a child at `place`. */
  private placeContext(place: Place, pinned: boolean): { flowChild: boolean; gridChild: boolean } {
    return { flowChild: !pinned, gridChild: !pinned && place.parentDisplay === 'grid' };
  }

  /** True when the raw style says position:absolute. */
  private rawPinned(attrs: Map<string, string | null>): boolean {
    return /(?:^|;)\s*position\s*:\s*absolute\s*(?:;|$|!)/i.test(attrs.get('style') ?? '');
  }

  /** A childless element (hr). */
  private leaf<T extends SlideNode>(el: HtmlElement, attrs: Map<string, string | null>, place: Place, element: ElementKind, node: T): T {
    const pinned = this.rawPinned(attrs);
    node.style = this.style(el, attrs.get('style') ?? '', { element, pinned, ...this.placeContext(place, pinned) });
    this.common(node, el, attrs, place, [], pinned);
    this.contentless(el);
    return node;
  }

  private contentless(el: HtmlElement): void {
    if (el.children.some((n) => n.type === 'element' || (n.type === 'text' && n.value.trim()))) {
      this.warn(`${describe(el)} holds no content; what is inside it was dropped`, el);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Text                                                                      */
  /* ------------------------------------------------------------------------ */

  private text(el: HtmlElement, attrs: Map<string, string | null>, place: Place, inBox = false): TextNode {
    const pinned = this.rawPinned(attrs);
    const node: TextNode = { kind: 'text', tag: el.tag as TextTag, style: {}, runs: [] };
    if (inBox) {
      if (attrs.get('style')) this.unsupported(`${describe(el)} inside <div data-text> is unstyled — style the div; dropped`, el);
      for (const name of attrs.keys()) if (name !== 'style') this.attribute(name, el, describe(el));
    } else {
      node.style = this.style(el, attrs.get('style') ?? '', { element: 'text', pinned, ...this.placeContext(place, pinned) });
      this.common(node, el, attrs, place, [], pinned);
    }
    node.runs = trimRuns(this.inline(el.children, {}, el));
    this.textLimits(node.runs, el);
    if (!inBox) this.textLints(node, el, place, pinned);
    return node;
  }

  private list(el: HtmlElement, attrs: Map<string, string | null>, place: Place, inBox = false): ListNode {
    const pinned = this.rawPinned(attrs);
    const node: ListNode = { kind: 'list', tag: el.tag as 'ul' | 'ol', style: {}, items: [] };
    if (inBox) {
      node.style = this.markerStyle(el, attrs.get('style') ?? '', `${describe(el)} inside <div data-text> takes only its markers — style the div`);
      for (const name of attrs.keys()) {
        if (name === 'start' || name === 'reversed') this.warn(`${describe(el)} ${name} inside <div data-text> is ignored; it counts from 1`, el);
        else if (name !== 'style') this.attribute(name, el, describe(el));
      }
    } else {
      node.style = this.style(el, attrs.get('style') ?? '', { element: 'list', pinned, ...this.placeContext(place, pinned) });
      this.numbering(node, el, attrs);
      this.common(node, el, attrs, place, ['start', 'reversed'], pinned);
    }
    const looks = new Map<number, Set<string>>();
    const margins: Array<{ read: ItemMarginRead; el: HtmlElement }> = [];
    this.listItems(el, 0, node, looks, margins);
    const itemMargin = this.itemMargin(el, margins, inBox);
    if (itemMargin) node.itemMargin = itemMargin;
    for (const [level, seen] of looks) {
      if (seen.size > 1) {
        this.warn(`${describe(el)}: the lists at level ${level + 1} have different markers; they all take the default`, el);
        continue;
      }
      const look = JSON.parse([...seen][0]!) as StyleMap;
      if (Object.keys(look).length) node.levels = { ...node.levels, [level]: look };
    }
    const allRuns = node.items.flatMap((item) => item.runs);
    this.textLimits(allRuns, el);
    return node;
  }

  /**
   * The items of a list and of the lists nested in them, in reading order:
   * an `<li>` may end with a `<ul>`/`<ol>` of sub-items one level further in
   * (at most {@link LIST_LEVELS} levels), and `data-indent="N"` puts an item
   * N levels further in than where it sits.
   */
  private listItems(el: HtmlElement, level: number, node: ListNode, looks: Map<number, Set<string>>, margins: Array<{ read: ItemMarginRead; el: HtmlElement }>): void {
    for (const child of el.children) {
      if (child.type === 'comment') continue;
      if (child.type === 'text') {
        if (child.value.trim()) this.warn(`text directly in <${el.tag}> — wrap it in <li>; dropped`, child);
        continue;
      }
      if (child.tag !== 'li') {
        this.error(`<${child.tag}> in <${el.tag}> — a list holds plain <li> items`, child);
        continue;
      }
      let itemLevel = level;
      const liAttrs = attrMap(child);
      let read: ItemMarginRead = { margin: { top: 0, bottom: 0 }, sideways: false };
      for (const [name, value] of liAttrs) {
        if (name === 'style') {
          const declarations = splitDeclarations(value ?? '');
          const others = declarations.map(([n]) => n.toLowerCase()).filter((n) => !isMarginProperty(n));
          if (others.length) this.unsupported(`<li> ${others.join(', ')}: an item takes only a top and bottom margin — style the list; dropped`, child);
          read = readItemMargin(declarations);
        } else if (name === 'data-indent') {
          const steps = (value ?? '').trim();
          if (/^\d$/.test(steps)) itemLevel = level + Number(steps);
          else this.warn(`<li data-indent="${steps.slice(0, 20)}"> — a number of levels 0–${LIST_LEVELS - 1}; ignored`, child);
        } else this.attribute(name, child, '<li>');
      }
      margins.push({ read, el: child });
      if (itemLevel > LIST_LEVELS - 1) {
        this.warn(`a list item ${itemLevel + 1} levels in — lists go ${LIST_LEVELS} levels deep; kept at the last`, child);
        itemLevel = LIST_LEVELS - 1;
      }
      const isSublist = (n: HtmlNode): n is HtmlElement => n.type === 'element' && (n.tag === 'ul' || n.tag === 'ol');
      const runs = trimRuns(normalizeRuns(this.inline(child.children.filter((n) => !isSublist(n)), {}, child)));
      node.items.push(itemLevel > 0 ? { runs, level: itemLevel } : { runs });
      for (const sub of child.children.filter(isSublist)) {
        const subLevel = Math.min(LIST_LEVELS - 1, itemLevel + 1);
        const subAttrs = attrMap(sub);
        const look = this.markerStyle(sub, subAttrs.get('style') ?? '', `a nested <${sub.tag}> takes only its markers — style the outer list`);
        for (const name of subAttrs.keys()) {
          if (name === 'start' || name === 'reversed') this.warn(`a nested <${sub.tag} ${name}> is ignored; it counts from 1`, sub);
          else if (name !== 'style') this.attribute(name, sub, `<${sub.tag}>`);
        }
        if (!looks.has(subLevel)) looks.set(subLevel, new Set());
        looks.get(subLevel)!.add(JSON.stringify(look, Object.keys(look).sort()));
        if (sub.tag !== el.tag && level === 0 && itemLevel === 0) this.note(`a nested <${sub.tag}> in <${el.tag}> takes the outer list's markers`, sub);
        this.listItems(sub, subLevel, node, looks, margins);
      }
    }
  }

  /** The top and bottom margin every item of a list gives itself alike; the rest is reported and dropped. */
  private itemMargin(list: HtmlElement, margins: ReadonlyArray<{ read: ItemMarginRead; el: HtmlElement }>, inBox: boolean): ItemMargin | undefined {
    for (const { read, el } of margins) {
      if (read.reason) this.unsupported(`<li> ${read.reason}; dropped`, el);
      if (read.sideways) this.unsupported('<li> margin-left / margin-right: an item keeps only its top and bottom margin; dropped', el);
    }
    const values = new Set(margins.map(({ read }) => (read.margin ? `${read.margin.top} ${read.margin.bottom}` : 'none')));
    const first = margins[0]?.read.margin;
    if (values.size !== 1 || !first) {
      if ([...values].some((v) => v !== '0 0' && v !== 'none')) this.unsupported(`${describe(list)}: its items give themselves different margins — every <li> takes the same top and bottom margin; dropped`, list);
      return undefined;
    }
    if (first.top === 0 && first.bottom === 0) return undefined;
    if (inBox) {
      this.unsupported(`${describe(list)} inside <div data-text>: an <li> takes no margin there — style the div; dropped`, list);
      return undefined;
    }
    return { top: first.top, bottom: first.bottom };
  }

  /** The marker declarations of a list that takes nothing else; the rest is reported with `elsewhere`. */
  private markerStyle(el: HtmlElement, text: string, elsewhere: string): StyleMap {
    const markers: string[] = [];
    const others: string[] = [];
    for (const [name, value] of splitDeclarations(text)) {
      if (/^list-style(?:-type|-position)?$/i.test(name)) markers.push(`${name}:${value}`);
      else others.push(name.toLowerCase());
    }
    if (others.length) this.unsupported(`${elsewhere}; ${others.join(', ')} dropped`, el);
    return markers.length ? this.style(el, markers.join(';'), { element: 'list', pinned: false, flowChild: false, gridChild: false }) : {};
  }

  /** `<ol start>` and `<ol reversed>`. */
  private numbering(node: ListNode, el: HtmlElement, attrs: Map<string, string | null>): void {
    for (const name of ['start', 'reversed'] as const) {
      if (!attrs.has(name)) continue;
      if (node.tag !== 'ol') {
        this.warn(`<ul ${name}> — only an <ol> is numbered; ignored`, el);
        continue;
      }
      if (name === 'reversed') {
        node.reversed = true;
        continue;
      }
      const value = (attrs.get('start') ?? '').trim();
      if (/^-?\d{1,5}$/.test(value)) node.start = Number(value);
      else this.warn(`<ol start="${value.slice(0, 20)}"> — a whole number; ignored, it counts from 1`, el);
    }
  }

  private textbox(el: HtmlElement, attrs: Map<string, string | null>, place: Place): TextBoxNode {
    const pinned = this.rawPinned(attrs);
    const node: TextBoxNode = { kind: 'textbox', style: {}, blocks: [] };
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'textbox', pinned, ...this.placeContext(place, pinned) });
    this.common(node, el, attrs, place, ['data-text'], pinned);
    const indent = (attrs.get('data-text') ?? '').trim();
    if (indent) {
      if (/^\d+$/.test(indent) && Number(indent) <= 256) node.indent = Number(indent);
      else this.warn(`data-text="${indent}" — the list indent is a whole number of px (0–256); ignored`, el);
    }
    const inner: Place = { ...place, section: false, depth: place.depth + 1 };
    for (const child of el.children) {
      if (child.type === 'comment') continue;
      if (child.type === 'text') {
        if (child.value.trim()) this.warn('text directly in <div data-text> — wrap it in <p>; dropped', child);
        continue;
      }
      const childAttrs = attrMap(child);
      let block: TextBlock | null = null;
      if (child.tag === 'p' || child.tag === 'h1' || child.tag === 'h2' || child.tag === 'h3') block = this.text(child, childAttrs, inner, true);
      else if (child.tag === 'ul' || child.tag === 'ol') block = this.list(child, childAttrs, inner, true);
      else this.error(`<${child.tag}> in <div data-text> — a text box holds unstyled <p>, <h1>–<h3>, <ul>, <ol>`, child);
      if (block) node.blocks.push(block);
    }
    const allRuns = node.blocks.flatMap((b) => (b.kind === 'text' ? b.runs : b.items.flatMap((item) => item.runs)));
    this.textLimits(allRuns, el);
    return node;
  }

  private textLimits(runs: readonly Run[], el: HtmlElement): void {
    const chars = runsLength(runs);
    if (chars > LIMITS.textChars) this.error(`${describe(el)} holds ${chars} characters — at most ${LIMITS.textChars}`, el);
    const marks = countMarks(runs);
    if (marks > LIMITS.inlineMarks) this.error(`${describe(el)} holds ${marks} inline marks — at most ${LIMITS.inlineMarks}`, el);
  }

  /** Inline content → runs. */
  private inline(nodes: HtmlNode[], marks: Marks, owner: HtmlElement): Run[] {
    const runs: Run[] = [];
    for (const node of nodes) {
      if (node.type === 'comment') continue;
      if (node.type === 'text') {
        runs.push({ text: collapse(node.value), marks: { ...marks } });
        continue;
      }
      const tag = node.tag;
      if (tag === 'br') {
        runs.push({ text: '\n', marks: { ...marks } });
        continue;
      }
      const attrs = attrMap(node);
      const next: Marks = { ...marks };
      switch (tag) {
        case 'b':
        case 'strong':
          next.b = true;
          delete next.regular;
          if (tag === 'strong') this.note('<strong> → <b>', node);
          break;
        case 'i':
        case 'em':
          next.i = true;
          if (tag === 'em') this.note('<em> → <i>', node);
          break;
        case 'u':
          next.u = true;
          break;
        case 'a': {
          const href = (attrs.get('href') ?? '').trim();
          if (isSafeHref(href)) next.href = href;
          else this.warn(`<a href="${href.slice(0, 60)}"> — links are http(s) only; the link was dropped, the text kept`, node);
          break;
        }
        case 'span':
          this.spanMarks(node, attrs.get('style') ?? '', next);
          break;
        default:
          if (SOFT_INLINE_TAGS.has(tag)) {
            this.warn(`<${tag}> is not in the subset — its text was kept`, node);
          } else if (BLOCK_TAGS.has(tag) || tag === 'li') {
            this.error(`<${tag}> inside ${describe(owner)} — text holds inline <b> <i> <u> <a> <span> <br> only`, node);
            continue;
          } else {
            this.error(`<${tag}> inside ${describe(owner)} is not in the subset`, node);
            continue;
          }
      }
      for (const [name] of attrs) {
        if (name === 'style' && tag === 'span') continue;
        if (name === 'href' && tag === 'a') continue;
        if (name === 'target' || name === 'rel') continue;
        if (name === 'style') this.unsupported(`<${tag} style> — only <span> takes a style (color); dropped`, node);
        else if (!SOFT_INLINE_TAGS.has(tag)) this.attribute(name, node, `<${tag}>`);
      }
      runs.push(...this.inline(node.children, next, owner));
    }
    return runs;
  }

  /** A `<span style>`: color, bold or regular weight, italic, underline. */
  private spanMarks(el: HtmlElement, text: string, marks: Marks): void {
    const ctx: StyleContext = { element: 'span', pinned: false, flowChild: false, gridChild: false, faces: this.faces };
    for (const [name, value] of splitDeclarations(text)) {
      const result = parseDeclaration(name, value, ctx);
      if (!result.ok) {
        if (result.noop) continue;
        if (name === 'font-weight') this.unsupported(`<span> ${result.reason}; dropped`, el);
        else this.unsupported(`<span> ${result.reason} — no sizes or fonts on spans (use two blocks); dropped`, el);
        continue;
      }
      for (const [property, v] of result.set) {
        if (property === 'color') marks.color = v;
        else if (property === 'font-weight') {
          if (v === '700') {
            marks.b = true;
            delete marks.regular;
            this.note('<span style="font-weight"> → <b>', el);
          } else {
            marks.regular = true;
            delete marks.b;
          }
        } else if (property === 'font-style') {
          if (v === 'italic') {
            marks.i = true;
            this.note('<span style="font-style:italic"> → <i>', el);
          }
        } else if (property === 'text-decoration') {
          marks.u = true;
          this.note('<span style="text-decoration:underline"> → <u>', el);
        }
      }
    }
  }

  /** Lints of a text block. */
  private textLints(node: TextNode, el: HtmlElement, place: Place, pinned: boolean): void {
    if (!this.lintsOn) return;
    const size = readPx(node.style['font-size']) ?? (node.tag === 'p' ? place.fontSize : TEXT_DEFAULTS[node.tag].fontSize);
    // Contrast against the nearest solid background.
    const color = rgba(node.style.color) ?? place.color;
    const background = solidBackground(node.style) ?? place.background;
    if (color && background && node.style['-webkit-text-fill-color'] !== 'transparent') {
      const ratio = contrastRatio(color, background);
      const need = size >= 44 ? 3 : 4.5;
      if (ratio < need) this.lint(`${describe(el)} text contrast is ${ratio.toFixed(1)}:1 (needs ${need}:1 at ${size}px)`, el);
    }
    // A box narrower than its longest word.
    const width = readPx(node.style.width);
    if (width !== undefined && node.style['white-space'] !== 'nowrap') {
      const longest = Math.max(0, ...node.runs.flatMap((r) => r.text.split(/[\s\n]+/)).map((w) => w.length));
      const pad = paddingX(node.style['padding']);
      if (longest * 0.6 * size + pad > width + 1) this.lint(`${describe(el)} is ${width}px wide but its longest word needs ≈${Math.round(longest * 0.6 * size + pad)}px (it would break mid-word)`, el);
    }
    if (pinned) {
      const rect = pinnedRect(node.style);
      if (rect) this.pinnedText.push({ rect, at: el });
    }
  }

  /** Overlapping pinned text boxes with known rectangles. */
  private lintOverlaps(): void {
    const boxes = this.pinnedText;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [ax, ay, aw, ah] = boxes[i]!.rect;
        const [bx, by, bw, bh] = boxes[j]!.rect;
        const ix = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
        const iy = Math.min(ay + ah, by + bh) - Math.max(ay, by);
        if (ix > 8 && iy > 8) this.lint(`two pinned text boxes overlap (${Math.round(ix)}×${Math.round(iy)}px)`, boxes[j]!.at);
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Containers                                                                */
  /* ------------------------------------------------------------------------ */

  private box(el: HtmlElement, attrs: Map<string, string | null>, place: Place): BoxNode {
    const pinned = this.rawPinned(attrs);
    const node: BoxNode = { kind: 'box', style: {}, children: [] };
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'div', pinned, ...this.placeContext(place, pinned) });
    this.common(node, el, attrs, place, ['data-group'], pinned);
    if (attrs.has('data-group')) node.group = true;
    const depth = place.depth + 1;
    if (depth > LIMITS.divDepth) {
      this.error(`<div> nested ${depth} deep — at most ${LIMITS.divDepth} levels`, el);
      return node;
    }
    const inner: Place = {
      section: false,
      parentDisplay: displayOf(node.style),
      depth,
      color: rgba(node.style.color) ?? place.color,
      background: solidBackground(node.style) ?? place.background,
      fontSize: readPx(node.style['font-size']) ?? place.fontSize,
    };
    node.children = this.children(el.children, inner);
    const pinnedChildren = node.children.filter(isPinned).length;
    if (pinnedChildren > 0 && node.style.position !== 'relative' && !pinned) {
      this.note('position:absolute inside a <div> without position:relative pins to the slide', el);
    }
    if (pinnedChildren > LIMITS.pinnedPerHost) this.error(`${pinnedChildren} positioned children in one <div> — at most ${LIMITS.pinnedPerHost}`, el);
    if (node.group && node.children.length > LIMITS.group) this.warn(`a group of ${node.children.length} — at most ${LIMITS.group} in one group`, el);
    return node;
  }

  /* ------------------------------------------------------------------------ */
  /* Media                                                                     */
  /* ------------------------------------------------------------------------ */

  /** Accepts `/_blob/<id>` or `project/ds/<folder>/<path>`. */
  private assetPath(value: string, el: HtmlElement, what: string): string | undefined {
    const src = value.trim();
    if (BLOB_PATTERN.test(src)) {
      this.assets.add(src);
      return src;
    }
    if (/^_blob\/[0-9a-f]{32}$/.test(src)) {
      this.assets.add(`/${src}`);
      this.note(`${what} "${src}" → "/${src}"`, el);
      return `/${src}`;
    }
    if (/^project\/ds\/[a-z0-9][a-z0-9_-]{0,63}\/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/){0,8}[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(src) && !src.includes('..')) {
      this.assets.add(src);
      return src;
    }
    if (/^data:/i.test(src)) this.error(`${what} is a data: URI — upload the file and use its /_blob/<id>`, el);
    else if (/^https?:/i.test(src)) this.error(`${what} is a URL — images are not fetched; upload the file and use its /_blob/<id>`, el);
    else this.error(`${what} "${src.slice(0, 80)}" — use an uploaded /_blob/<id> or a project/ds/<folder>/… path`, el);
    return undefined;
  }

  private image(el: HtmlElement, attrs: Map<string, string | null>, place: Place): ImageNode {
    const pinned = this.rawPinned(attrs);
    const isVideo = el.tag === 'video';
    const node: ImageNode = { kind: 'image', style: {} };
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'img', pinned, ...this.placeContext(place, pinned) });
    const handled = ['src', 'alt', 'data-crop', 'poster', 'aria-label', 'data-video', 'data-video-at', 'data-video-start', 'data-video-delay', 'data-video-sound', 'data-video-loop', 'data-video-still', 'autoplay', 'loop', 'muted', 'playsinline', 'controls', 'width', 'height', ...VIDEO_PROVIDERS.map((p) => `data-video-${p}`)];
    this.common(node, el, attrs, place, handled, pinned);
    if (isVideo) this.note('<video> is saved as <img data-video>', el);
    const still = isVideo ? attrs.get('poster') : attrs.get('src');
    if (still) node.src = this.assetPath(still, el, isVideo ? '<video poster>' : '<img src>');
    const alt = (isVideo ? attrs.get('aria-label') : attrs.get('alt')) ?? undefined;
    if (alt !== undefined) {
      const text = alt.replace(/\s+/g, ' ').trim();
      if (text.length > LIMITS.alt) this.warn(`alt is over ${LIMITS.alt} characters; cut`, el);
      node.alt = text.slice(0, LIMITS.alt);
    }
    const crop = attrs.get('data-crop');
    if (crop) {
      const parsed = parseCrop(crop);
      if (parsed) node.crop = parsed;
      else this.warn(`data-crop="${crop}" — "ZOOM X% Y%" with zoom 1–50; dropped`, el);
    }
    const video = this.video(el, attrs, isVideo);
    if (video) node.video = video;
    if (attrs.has('width') || attrs.has('height')) this.note('<img width/height> attributes are ignored — size it with style', el);
    this.contentless(isVideo ? { ...el, children: [] } : el);
    if (el.children.length && isVideo && el.children.some((n) => n.type === 'element')) {
      this.warn('<video> holds no elements here (<source>, <track>) — name the clip in src', el);
    }
    return node;
  }

  private video(el: HtmlElement, attrs: Map<string, string | null>, isVideo: boolean): VideoSpec | undefined {
    const spec: VideoSpec = {};
    const clip = (isVideo ? attrs.get('src') : attrs.get('data-video'))?.trim();
    if (clip) {
      if (BLOB_PATTERN.test(clip)) {
        spec.src = clip;
        this.assets.add(clip);
      } else {
        this.unsupported(`${isVideo ? '<video src>' : 'data-video'}="${clip.slice(0, 60)}" — a clip is an uploaded /_blob/<id>; dropped, the picture stays`, el);
      }
    }
    for (const provider of VIDEO_PROVIDERS) {
      const id = attrs.get(`data-video-${provider}`);
      if (id === undefined || id === null) continue;
      const link = normalizeVideoLink({ provider, id: id.trim() });
      if (spec.src || spec.link) this.warn(`data-video-${provider} beside another video — dropped`, el);
      else if (link) spec.link = link;
      else this.unsupported(`data-video-${provider}="${id.slice(0, 60)}" — write only the video's id; dropped`, el);
    }
    const at = attrs.get('data-video-at');
    if (at !== undefined && at !== null) {
      const start = normalizeVideoStart(at);
      if (!spec.link) this.warn('data-video-at needs a hosted video on the same <img>; dropped', el);
      else if (spec.link.provider === 'drive') this.warn('data-video-at — no start time is kept for a Google Drive video; dropped', el);
      else if (start !== undefined) spec.link = { ...spec.link, start };
    }
    if (!spec.src && !spec.link) return undefined;
    if (spec.src) {
      const sound = attrs.get('data-video-sound')?.trim().toLowerCase();
      if (sound === 'on') spec.sound = true;
      else if (sound !== undefined && sound !== 'off') this.warn(`data-video-sound="${sound}" — on | off; using off`, el);
      if (isVideo && attrs.has('muted') === false && attrs.has('data-video-sound') === false) spec.sound = undefined;
      const loop = attrs.get('data-video-loop')?.trim().toLowerCase();
      if (loop === 'off') spec.loop = false;
      else if (loop !== undefined && loop !== 'on') this.warn(`data-video-loop="${loop}" — on | off; using on`, el);
      const start = attrs.get('data-video-start')?.trim().toLowerCase();
      if (start === 'click') spec.startOnClick = true;
      else if (start !== undefined && start !== 'auto') this.warn(`data-video-start="${start}" — auto | click; using auto`, el);
      const delay = attrs.get('data-video-delay')?.trim();
      if (delay !== undefined) {
        const n = Number(delay);
        if (Number.isFinite(n) && n >= 0) spec.delay = Math.min(LIMITS.videoDelay, Math.round(n * 10) / 10) || undefined;
        else this.warn(`data-video-delay="${delay}" — seconds 0–60; ignored`, el);
      }
      const still = attrs.get('data-video-still')?.trim();
      if (still === 'clip') spec.still = still;
    } else {
      const still = attrs.get('data-video-still')?.trim();
      if (still && /^(?:auto|custom|\d{1,7})$/.test(still)) spec.still = still;
    }
    return spec;
  }

  private table(el: HtmlElement, attrs: Map<string, string | null>, place: Place): TableNode {
    const pinned = this.rawPinned(attrs);
    const node: TableNode = { kind: 'table', style: {}, rows: [] };
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'table', pinned, ...this.placeContext(place, pinned) });
    this.common(node, el, attrs, place, [], pinned);
    const rowEls: HtmlElement[] = [];
    const collect = (nodes: HtmlNode[]): void => {
      for (const child of nodes) {
        if (child.type === 'comment') continue;
        if (child.type === 'text') {
          if (child.value.trim()) this.warn('text directly in <table> — dropped', child);
          continue;
        }
        if (child.tag === 'tr') rowEls.push(child);
        else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
          this.note(`<${child.tag}> is implied; its rows were kept`, child);
          collect(child.children);
        } else if (child.tag === 'caption' || child.tag === 'colgroup' || child.tag === 'col') {
          this.unsupported(`<${child.tag}> is not in the subset; dropped`, child);
        } else this.error(`<${child.tag}> in <table> — a table holds <tr> rows of <th>/<td> cells`, child);
      }
    };
    collect(el.children);
    let padding: string | undefined;
    let columns = 0;
    for (const rowEl of rowEls) {
      const rowAttrs = attrMap(rowEl);
      const row: TableRow = { style: {}, cells: [] };
      row.style = this.style(rowEl, rowAttrs.get('style') ?? '', { element: 'tr', pinned: false, flowChild: false, gridChild: false });
      for (const name of rowAttrs.keys()) if (name !== 'style') this.attribute(name, rowEl, '<tr>');
      for (const cellEl of rowEl.children) {
        if (cellEl.type === 'comment') continue;
        if (cellEl.type === 'text') {
          if (cellEl.value.trim()) this.warn('text directly in <tr> — dropped', cellEl);
          continue;
        }
        if (cellEl.tag !== 'td' && cellEl.tag !== 'th') {
          this.error(`<${cellEl.tag}> in <tr> — a row holds <th>/<td> cells`, cellEl);
          continue;
        }
        const cellAttrs = attrMap(cellEl);
        const cell: TableCell = { tag: cellEl.tag, runs: [], style: {} };
        cell.style = this.style(cellEl, cellAttrs.get('style') ?? '', {
          element: 'cell',
          header: cellEl.tag === 'th',
          pinned: false,
          flowChild: false,
          gridChild: false,
        });
        for (const name of cellAttrs.keys()) {
          if (name === 'style') continue;
          if (name === 'colspan' || name === 'rowspan') this.unsupported(`<${cellEl.tag} ${name}> — no merged cells; dropped`, cellEl);
          else this.attribute(name, cellEl, `<${cellEl.tag}>`);
        }
        if (cell.style.padding !== undefined) {
          if (padding === undefined) padding = cell.style.padding;
          else if (padding !== cell.style.padding) {
            this.warn(`cell padding "${cell.style.padding}" differs — one padding per table; using "${padding}"`, cellEl);
            cell.style.padding = padding;
          }
          if (this.lintsOn && /^\S+ 0$|^\S+ 0 \S+$|^\S+ 0 \S+ 0$/.test(cell.style.padding)) {
            this.lint('a text cell with padding:… 0 puts its text on the column rules', cellEl);
          }
        }
        cell.runs = trimRuns(this.inline(cellEl.children, {}, cellEl));
        this.textLimits(cell.runs, cellEl);
        row.cells.push(cell);
        this.cells++;
      }
      columns = Math.max(columns, row.cells.length);
      node.rows.push(row);
    }
    if (node.rows.length > LIMITS.tableRows || columns > LIMITS.tableColumns) {
      this.error(`a table of ${node.rows.length} × ${columns} — at most ${LIMITS.tableRows} rows × ${LIMITS.tableColumns} columns`, el);
    }
    // Uneven rows heal to the widest row.
    for (const row of node.rows) {
      if (row.cells.length < columns) {
        this.warn(`a row of ${row.cells.length} cells in a ${columns}-column table — filled with empty cells`, el);
        while (row.cells.length < columns) row.cells.push({ tag: 'td', runs: [], style: {} });
      }
    }
    if (node.rows.length === 0) this.warn('an empty <table>', el);
    return node;
  }

  private svg(el: HtmlElement, attrs: Map<string, string | null>, place: Place): SvgNode {
    const pinned = this.rawPinned(attrs);
    const raw = this.source.slice(el.start, el.end);
    const bytes = new TextEncoder().encode(raw).length;
    if (bytes > LIMITS.svgBytes) this.error(`an <svg> of ${Math.round(bytes / 1024)} KB — at most ${LIMITS.svgBytes / 1024} KB`, el);
    const node: SvgNode = { kind: 'svg', style: {}, markup: '' };
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'svg', pinned, ...this.placeContext(place, pinned) });
    const own = ['id', 'style', 'data-build-in', 'data-build-out', 'data-fit'];
    this.common(node, el, new Map([...attrs].filter(([name]) => own.includes(name))), place, [], pinned);
    // Validate the drawing: no scripts, handlers, foreign content or URLs.
    const check = (nodes: HtmlNode[]): void => {
      for (const child of nodes) {
        if (child.type !== 'element') continue;
        const tag = child.tag;
        if (tag === 'script') this.error('<svg> holds a <script> — drawings never run code', child);
        if (tag === 'foreignobject') this.error('<svg> holds <foreignObject> — not allowed', child);
        if (tag === 'text' || tag === 'tspan') {
          this.warn('<svg> <text> — fonts never load in an svg; put labels in <p>s over it', child);
        }
        for (const attr of child.attrs) {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on')) this.error(`<svg> ${name}= — event handlers are not allowed`, child);
          if ((name === 'href' || name === 'xlink:href' || name === 'src') && attr.value && !attr.value.trim().startsWith('#')) {
            this.error(`<svg> ${name}="${attr.value.slice(0, 60)}" — only local #id references`, child);
          }
          if (attr.value && /url\(\s*['"]?(?!#)/i.test(attr.value)) this.error('<svg> url() to anything but a local #id', child);
        }
        if (tag === 'style') {
          const css = child.children.map((n) => (n.type === 'text' ? n.value : '')).join('');
          if (/url\(\s*['"]?(?!#)|@import/i.test(css)) this.error('<svg> <style> loads an external resource', child);
        }
        check(child.children);
      }
    };
    for (const attr of el.attrs) {
      if (attr.name.toLowerCase().startsWith('on')) this.error(`<svg> ${attr.name}= — event handlers are not allowed`, el);
    }
    check(el.children);
    // Keep the markup minus the attributes the node carries itself.
    const kept = el.attrs.filter((attr) => {
      const name = attr.name.toLowerCase();
      return !own.includes(name) && !name.startsWith('on') && !(name.startsWith('data-') && name !== 'data-name');
    });
    const head = `<${el.rawTag}${kept.map((attr) => (attr.value === null ? ` ${attr.name}` : ` ${attr.name}="${escapeAttr(attr.value)}"`)).join('')}>`;
    const inner = el.closeStart >= 0 ? this.source.slice(el.openEnd, el.closeStart) : '';
    node.markup = `${head}${inner}</${el.rawTag}>`;
    if (!/\sxmlns=/.test(head)) node.markup = node.markup.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return node;
  }

  private shape(el: HtmlElement, attrs: Map<string, string | null>, place: Place): ShapeNode | null {
    const kind = (attrs.get('kind') ?? 'rect').trim().toLowerCase();
    if (!(SHAPE_KINDS as readonly string[]).includes(kind)) {
      this.error(`<x-shape kind="${kind}"> — kind is one of ${SHAPE_KINDS.join(', ')}`, el);
      return null;
    }
    const pinned = this.rawPinned(attrs);
    const node: ShapeNode = { kind: 'shape', shape: kind as ShapeKind, style: {} };
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'shape', shape: kind as ShapeKind, pinned, ...this.placeContext(place, pinned) });
    this.common(node, el, attrs, place, ['kind'], pinned);
    this.contentless(el);
    if (this.lintsOn && kind.startsWith('arrow-')) {
      const w = readPx(node.style.width);
      const h = readPx(node.style.height);
      if (w && h) {
        const ratio = kind === 'arrow-left' || kind === 'arrow-right' ? w / h : h / w;
        if (ratio > 3) this.lint(`a block arrow ${ratio.toFixed(1)}:1 — keep it near 2:1 (use a connector for long arrows)`, el);
      }
    }
    return node;
  }

  private icon(el: HtmlElement, attrs: Map<string, string | null>, place: Place): IconNode | null {
    const name = (attrs.get('name') ?? '').trim();
    if (!isIconName(name)) {
      this.error(`<x-icon name="${name.slice(0, 40)}"> — not a built-in icon name (exact case)`, el);
      return null;
    }
    const pinned = this.rawPinned(attrs);
    const node: IconNode = { kind: 'icon', name, style: {} };
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'icon', pinned, ...this.placeContext(place, pinned) });
    this.common(node, el, attrs, place, ['name'], pinned);
    this.contentless(el);
    if (this.lintsOn) {
      const size = Math.min(readPx(node.style.width) ?? 64, readPx(node.style.height) ?? 64);
      if (size < 32) this.lint(`an icon ${size}px across draws its glyph at about half that — give it at least 32px`, el);
    }
    return node;
  }

  private connector(el: HtmlElement, attrs: Map<string, string | null>, place: Place): ConnectorNode | null {
    const coordNames = ['x1', 'y1', 'x2', 'y2'] as const;
    const given = coordNames.filter((name) => attrs.has(name));
    const node: ConnectorNode = { kind: 'connector', style: {}, headStart: 'none', headEnd: 'filled', route: 'straight' };
    if (given.length > 0) {
      if (given.length < 4) {
        this.error(`<x-connector> is missing ${coordNames.filter((n) => !attrs.has(n)).join(', ')}`, el);
        return null;
      }
      const points = {} as NonNullable<ConnectorNode['points']>;
      for (const name of coordNames) {
        const coord = parseCoord(attrs.get(name) ?? '');
        if (!coord) {
          this.error(`<x-connector ${name}="${attrs.get(name)}"> — a coordinate is N (px) or N%`, el);
          return null;
        }
        points[name] = coord;
      }
      node.points = points;
    }
    const pinned = node.points !== undefined;
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'connector', pinned, ...this.placeContext(place, pinned) });
    if (pinned) {
      for (const property of ['left', 'top', 'right', 'bottom', 'width', 'height'] as const) {
        if (node.style[property] !== undefined) {
          this.unsupported(`<x-connector> ${property} — a connector is placed by x1 y1 x2 y2; dropped`, el);
          delete node.style[property];
        }
      }
    }
    for (const property of Object.keys(node.style) as CssProperty[]) {
      if (!['color', 'border-width', 'border-style', 'border', 'opacity', 'width', 'height', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'min-width', 'min-height', 'max-width', 'max-height', 'grid-column', 'grid-row', 'justify-self', 'aspect-ratio'].includes(property)) {
        this.unsupported(`<x-connector> ${property} — a connector carries color, border-width, border-style, head, route; dropped`, el);
        delete node.style[property];
      }
    }
    this.common(node, el, attrs, place, [...coordNames, 'head', 'head-start', 'head-end', 'route', 'from'], pinned);
    const head = (attrs.get('head') ?? 'end').trim().toLowerCase();
    if (head === 'end') [node.headStart, node.headEnd] = ['none', 'filled'];
    else if (head === 'both') [node.headStart, node.headEnd] = ['filled', 'filled'];
    else if (head === 'none') [node.headStart, node.headEnd] = ['none', 'none'];
    else this.warn(`head="${head}" — head is end, both or none (using end)`, el);
    for (const [name, key] of [['head-start', 'headStart'], ['head-end', 'headEnd']] as const) {
      const value = attrs.get(name)?.trim().toLowerCase();
      if (value === undefined) continue;
      if ((HEAD_KINDS as readonly string[]).includes(value)) node[key] = value as HeadKind;
      else this.warn(`${name}="${value}" — none, open or filled; ignored`, el);
    }
    const route = (attrs.get('route') ?? 'straight').trim().toLowerCase();
    if ((ROUTES as readonly string[]).includes(route)) node.route = route as Route;
    else this.warn(`route="${route}" — straight, elbow, hv or vh (using straight)`, el);
    const from = attrs.get('from')?.trim().toLowerCase();
    if (from !== undefined) {
      if (pinned) this.note('<x-connector from> applies to flow connectors only; ignored', el);
      else if ((CORNERS as readonly string[]).includes(from)) {
        if (from !== 'tl') node.from = from as Corner;
      } else this.warn(`from="${from}" — tl, tr, bl or br (using tl)`, el);
    }
    this.contentless(el);
    return node;
  }

  private embed(el: HtmlElement, attrs: Map<string, string | null>, place: Place): EmbedNode | null {
    const pinned = this.rawPinned(attrs);
    if (!place.section) {
      this.error('<x-embed> must be a direct child of <section>', el);
      return null;
    }
    if (!pinned) {
      this.error('<x-embed> must be pinned (position:absolute with left/top or right/bottom and width/height)', el);
      return null;
    }
    this.embeds++;
    if (this.embeds > LIMITS.embedsPerSlide) this.error(`${this.embeds} embeds — at most ${LIMITS.embedsPerSlide} on one slide`, el);
    const html = el.closeStart >= 0 ? this.source.slice(el.openEnd, el.closeStart) : '';
    const bytes = new TextEncoder().encode(html).length;
    if (bytes > LIMITS.embedBytes) this.error(`an <x-embed> of ${Math.round(bytes / 1024)} KB — at most ${LIMITS.embedBytes / 1024} KB`, el);
    const node: EmbedNode = { kind: 'embed', style: {}, html };
    node.style = this.style(el, attrs.get('style') ?? '', { element: 'embed', pinned: true, flowChild: false, gridChild: false });
    this.common(node, el, attrs, place, [], true);
    if (node.style.width === undefined || node.style.height === undefined) this.warn('<x-embed> needs a width and a height', el);
    return node;
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function describe(el: HtmlElement): string {
  const id = el.attrs.find((a) => a.name.toLowerCase() === 'id')?.value;
  return id ? `<${el.tag} id="${id.slice(0, 24)}">` : `<${el.tag}>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Reads `Npx` back to a number. */
export function readPx(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^(-?[\d.]+)px$/.exec(value) ?? (value === '0' ? ['0', '0'] : null);
  return m ? Number(m[1]) : undefined;
}

function paddingX(value: string | undefined): number {
  if (!value) return 0;
  const parts = value.split(/\s+/).map((part) => parseFloat(part) || 0);
  const right = parts[1] ?? parts[0] ?? 0;
  const left = parts[3] ?? right;
  return left + right;
}

function displayOf(style: StyleMap): 'flex' | 'grid' | 'none' {
  return style.display === 'grid' ? 'grid' : style.display === 'none' ? 'none' : 'flex';
}

function rgba(value: string | undefined): Rgba | null {
  if (!value) return null;
  const c = toRgba(value);
  return c && c.a > 0 ? c : null;
}

/** A style's solid background color (gradients and translucent fills ignored). */
function solidBackground(style: StyleMap): Rgba | null {
  if (!style.background) return null;
  const bg = parseBackground(style.background);
  if (!bg.ok || bg.value.gradient || bg.value.image || !bg.value.color) return null;
  const c = toRgba(bg.value.color);
  return c && c.a >= 0.95 ? c : null;
}

/** A pinned element's rect when its offsets and size are plain px. */
function pinnedRect(style: StyleMap): [number, number, number, number] | null {
  const left = readPx(style.left);
  const top = readPx(style.top);
  const width = readPx(style.width);
  const height = readPx(style.height);
  if (left === undefined || top === undefined || width === undefined || height === undefined) return null;
  return [left, top, width, height];
}

function parseCrop(value: string): Crop | null {
  const m = /^\s*([\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/.exec(value);
  if (!m) return null;
  const zoom = Number(m[1]);
  if (!(zoom >= 1 && zoom <= 50)) return null;
  const clamp = (n: number): number => Math.min(100, Math.max(0, n));
  return { zoom, x: clamp(Number(m[2])), y: clamp(Number(m[3])) };
}

function parseCoord(value: string): Coord | null {
  const v = value.trim();
  const pct = /^(-?[\d.]+)%$/.exec(v);
  if (pct) return { value: Number(pct[1]), unit: '%' };
  const len = /^(-?[\d.]+)(px)?$/.exec(v);
  if (len) return { value: Number(len[1]), unit: 'px' };
  return null;
}

/**
 * Comments a browser ends somewhere else than this reader: `<!-->`, `<!--->`
 * and `--!>` close at once there, and inside an `<iframe>` a comment is
 * plain text. An embedded page is its own document and is left alone.
 */
export function misreadComments(nodes: readonly HtmlNode[]): Array<{ node: HtmlNode; message: string }> {
  const out: Array<{ node: HtmlNode; message: string }> = [];
  const walk = (list: readonly HtmlNode[], inFrame: boolean): void => {
    for (const node of list) {
      if (node.type === 'comment') {
        if (!node.raw.startsWith('<!--')) continue;
        if (inFrame) out.push({ node, message: 'a comment inside <iframe> is text to a browser, and a "</iframe>" in it closes the frame — delete the comment' });
        else if (node.raw.startsWith('<!-->') || node.raw.startsWith('<!--->') || node.raw.slice(4).includes('--!>')) {
          out.push({ node, message: 'a browser closes this comment at once, so what follows it shows on the slide — write comments as <!-- text -->' });
        }
      } else if (node.type === 'element' && node.tag !== 'x-embed') walk(node.children, inFrame || node.tag === 'iframe');
    }
  };
  walk(nodes, false);
  return out;
}

/** Compiles one slide file. */
export function compileSlide(source: string, options: CompileOptions = {}): CompileResult {
  const compiler = new SlideCompiler(source, options);
  const slide = compiler.compile();
  const held = compiler.diagnostics.some((d) => d.level === 'error');
  return { slide, held, diagnostics: compiler.diagnostics, assets: [...compiler.assets], cells: compiler.cells };
}

/** The first error, stripped of markup characters, for `slideHeldWhy` (≈ 60 chars). */
export function heldReason(diagnostics: readonly Diagnostic[]): string | undefined {
  const first = diagnostics.find((d) => d.level === 'error');
  if (!first) return undefined;
  const text = first.message.replace(/^slide "[^"]*": /, '').replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** Unused-variable guard for constants imported for documentation. */
void SLIDE_WIDTH;
void SLIDE_HEIGHT;
void parseColor;
void isCssProperty;
