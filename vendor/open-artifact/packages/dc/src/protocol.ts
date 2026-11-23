/**
 * The contract between the editor and the board runtime (`support.js`)
 * running inside each artboard iframe.
 *
 * The editor creates the iframe (`sandbox="allow-scripts allow-same-origin"`,
 * `srcdoc` = the artboard source with `./support.js` pointing at the runtime)
 * and, before setting `srcdoc`, attaches a {@link BoardBoot} to the iframe
 * element as `iframe.__dcBoot`. The runtime reads it through
 * `window.frameElement`, reports through its callback, and exposes a
 * {@link BoardApi} as `window.__dc` for the editor to call directly.
 *
 * Opened on its own (an exported file, or the server serving a `.dc.html`
 * page), there is no boot object: the runtime fetches its own source and
 * runs as a plain page.
 */

/** How the board behaves. */
export type BoardMode =
  /** On the canvas: links do nothing, the editor owns the pointer. */
  | 'edit'
  /** Clicking through: handlers and links work. */
  | 'play'
  /** Rendered for export or thumbnail: no interaction. */
  | 'static';

/** Everything the runtime needs from the editor. */
export interface BoardBoot {
  /** Project-relative path of this artboard (`sub/Main.dc.html`). */
  path: string;
  /** The full `.dc.html` source. */
  source: string;
  mode: BoardMode;
  /** Tweak overrides on top of the `data-props` defaults. */
  props?: Record<string, unknown>;
  /** Loads another artboard's source, for `<dc-import>`. */
  load(path: string): Promise<string>;
  /** Receives runtime events. */
  report(event: BoardEvent): void;
}

/** A problem the board shows instead of (or over) its content. */
export interface BoardError {
  /** Where it came from. */
  source: 'script' | 'render' | 'import' | 'template' | 'props' | 'runtime';
  message: string;
}

/** Events the runtime reports. */
export type BoardEvent =
  /** First render finished. */
  | { type: 'booted'; size: BoardSize }
  /** The content size changed (throttled). */
  | { type: 'resized'; size: BoardSize }
  /** The set of current errors changed. */
  | { type: 'errors'; errors: BoardError[] }
  /** A link to another artboard was followed in Play. */
  | { type: 'navigate'; path: string }
  /**
   * In-place text editing finished with a change: the edited element's
   * `html` (unsanitized) and its `text`. A `target` says where text a
   * hole showed is written instead of the template. `link`: a link was just
   * set, the how-manyth `<a>` of `html` it is (the editor selects it).
   */
  | { type: 'text-commit'; tid: number; html: string; text: string; target?: TextEditTarget; link?: number }
  /** In-place text editing finished without a change. */
  | { type: 'text-cancel'; tid: number }
  /** The formatting at the caret while editing text (`active` false when editing stopped). */
  | { type: 'text-state'; active: false }
  | { type: 'text-state'; active: true; tid: number; plain: boolean; formats: TextFormats }
  /** The text being edited lost focus (the editor decides whether that ends the edit). */
  | { type: 'text-blur' }
  /**
   * The link at the selection is to be set: its current `href` (`''` for
   * none), whether the selection is empty, and where it is (board px).
   * Answer with {@link BoardApi.applyLink} or {@link BoardApi.cancelLinkEdit}.
   * `host`: the edited element is itself the link; its `href` attribute is
   * the editor's to set.
   */
  | { type: 'link-edit'; href: string; collapsed: boolean; rect: BoardRect; host?: boolean }
  /** A key the editor handles (undo, delete…) was pressed inside the frame. */
  | { type: 'key'; key: string; code?: string; meta: boolean; shift: boolean; alt: boolean };

/** Formatting toggles in-place text editing applies to the selection. */
export type TextFormat = 'bold' | 'italic' | 'underline' | 'ul' | 'ol' | 'link';

/** Which formats the selection has. */
export type TextFormats = Record<TextFormat, boolean>;

/** Text a hole shows, written where the value comes from. */
export type TextEditTarget =
  /** A text prop: its value. */
  | { kind: 'prop'; prop: string; value: string }
  /** A string literal of the logic script (offsets into the script body). */
  | { kind: 'script'; start: number; end: number; quote: string; value: string }
  /** Words of a component instance: between its tags (`__text`) or an attribute (`@name`). */
  | { kind: 'import'; key: string; words: string };

/** How {@link BoardApi.editText} starts. */
export interface TextEditOptions {
  /**
   * The element's content as written in the template, when it has holes:
   * edited as written unless a prop or a script literal supplies the text.
   */
  seed?: string;
  /** Current values of the text props (a seed of one whole `{{prop}}` edits the prop). */
  props?: Record<string, string>;
  /** The logic script's string literals (a hole showing exactly one of them edits it). */
  literals?: { start: number; end: number; quote: string; value: string }[];
  /**
   * `all` selects every word (default); `end` puts the caret after the last
   * one; a point (board px) puts it at the words there.
   */
  caret?: 'all' | 'end' | { x: number; y: number };
}

/** Words of a component instance the editor allows retyping (see `importTextTargets`). */
export interface ImportTextTargetSpec {
  words: string;
  key: string;
  number?: boolean;
}

/** Size of the rendered content in CSS pixels. */
export interface BoardSize {
  width: number;
  height: number;
}

/** A rectangle in the board's coordinate space (CSS pixels from its top-left). */
export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a pick at a point found. */
export interface PickResult {
  tid: number;
  /** Rect of the rendered instance that was hit. */
  rect: BoardRect;
  /** Index of that instance among the template node's rendered instances. */
  instance: number;
}

/** Computed values the properties panel shows for an element. */
export interface ElementInspection {
  tid: number;
  tag: string;
  rect: BoardRect;
  /** Selected computed style properties (kebab case). */
  computed: Record<string, string>;
  /** The parent's display (to offer flex/grid child controls). */
  parentDisplay: string;
  /** Text of the first instance (for the layers list and labels). */
  text: string;
}

/** What the runtime exposes as `window.__dc`. */
export interface BoardApi {
  /** Replace the source (template, script and props are re-read). */
  setSource(source: string): void;
  /** Other artboards changed: imported children with these paths reload. */
  invalidate(paths: readonly string[]): void;
  /** Replace the tweak overrides. */
  setProps(props: Record<string, unknown>): void;
  setMode(mode: BoardMode): void;
  /** The template node under a point, honoring import boundaries; `null` on empty space. */
  pick(x: number, y: number): PickResult | null;
  /** Every element under a point, innermost first (for deep select). */
  pickAll(x: number, y: number): PickResult[];
  /** Rects of every rendered instance of each template node. */
  rects(tids: readonly number[]): Record<number, BoardRect[]>;
  inspect(tid: number): ElementInspection | null;
  /**
   * The render values a loaded `<dc-import name>` component computes for
   * these props (its logic's `renderVals()`); `null` when it is not loaded
   * or its logic throws.
   */
  importValues(name: string, props: Record<string, unknown>): Record<string, unknown> | null;
  /** Content size. */
  size(): BoardSize;
  /** Current errors. */
  errors(): BoardError[];
  /** Starts in-place (rich) text editing of an instance; false when it cannot. */
  editText(tid: number, instance?: number, options?: TextEditOptions): boolean;
  /**
   * Edits words a component instance (`<x-import>` node `tid`) draws at
   * `x, y` (board px) in place, when they are one of `targets`; false
   * when there are none there. The edit reports a `text-commit` with an
   * `import` target.
   */
  editImportText(tid: number, instance: number, x: number, y: number, targets: ImportTextTargetSpec[]): boolean;
  /** Ends in-place text editing (`commit` false cancels). */
  endTextEdit(commit: boolean): void;
  /** Toggles a format on the selection of the text being edited (`link` asks for an address: `link-edit`). */
  formatText(format: TextFormat): void;
  /** Answers `link-edit`: links the saved selection to `href` (`''` or `null` unlinks). */
  applyLink(href: string | null): void;
  /** Answers `link-edit` without a change. */
  cancelLinkEdit(): void;
  /** Temporarily applies inline styles to a node's instances (drag previews); `null` restores. */
  preview(tid: number, style: Record<string, string> | null): void;
}

/** Window globals the runtime and editor share. */
declare global {
  interface Window {
    __dc?: BoardApi;
    __dcExport?: { path: string; source: string; files: Record<string, string> };
  }
  interface HTMLIFrameElement {
    __dcBoot?: BoardBoot;
  }
}
