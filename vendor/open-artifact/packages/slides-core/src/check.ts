/**
 * Whole-project checks of a Slides artifact: `deck.json` against the slide
 * files, then every slide file through the compiler. Paths are relative to
 * `project/` (the shape the type server hands over).
 */

import { compileSlide, type Diagnostic } from './compile.ts';
import { checkDeckIndex, parseDeckIndex, resolveOrder, type DeckIndex } from './deck.ts';
import { ID_PATTERN, LIMITS } from './limits.ts';
import { createSourceDeck, deckFormatKind, isFlatSlideHtml, NEEDS_FORMAT_KEY, readSourceSlide, slideMarkupMadeFor, type SourceDeck } from './source.ts';

/** Severity of a project finding (the type server's scale). */
export type ProjectLevel = 'error' | 'warning' | 'info';

/** A finding tied to a file under `project/`. */
export interface ProjectDiagnostic {
  /** Path under `project/`. */
  file: string;
  level: ProjectLevel;
  message: string;
  line?: number;
}

/** Options of {@link checkSlidesProject}. */
export interface CheckOptions {
  /**
   * Whether a referenced binary file exists (`/_blob/<id>` or a path under
   * `project/`). Text files are already in the map; without this callback
   * binary references are not checked.
   */
  exists?: (ref: string) => boolean;
  /** Report layout lints (contrast, overlap, …) as info. Default true. */
  lints?: boolean;
}

/** The index file, relative to `project/`. */
export const DECK_FILE = 'deck.json';
/** A source deck's shared stylesheet, relative to `project/`. */
export const DECK_CSS_FILE = 'deck.css';
/** The slides folder, relative to `project/`. */
export const SLIDES_FOLDER = 'slides/';

/** The slide id of a path under `project/`, or undefined. */
export function slideIdOfFile(path: string): string | undefined {
  if (!path.startsWith(SLIDES_FOLDER) || !path.endsWith('.html')) return undefined;
  const id = path.slice(SLIDES_FOLDER.length, -5);
  return ID_PATTERN.test(id) && !id.includes('/') ? id : undefined;
}

/** Maps a compiler level onto the project scale. */
function projectLevel(level: Diagnostic['level']): ProjectLevel {
  return level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info';
}

/** Checks a project given all of its text files (path under `project/` → content). */
export function checkSlidesProject(files: ReadonlyMap<string, string>, options: CheckOptions = {}): ProjectDiagnostic[] {
  const out: ProjectDiagnostic[] = [];
  const add = (file: string, level: ProjectLevel, message: string, line?: number): void => {
    out.push(line === undefined ? { file, level, message } : { file, level, message, line });
  };

  // Slide files: the folder is the source of truth for which slides exist.
  const slideIds = new Set<string>();
  for (const path of files.keys()) {
    if (!path.startsWith(SLIDES_FOLDER)) continue;
    const id = slideIdOfFile(path);
    if (id) slideIds.add(id);
    else if (path.endsWith('.html')) add(path, 'warning', `${path} is not a slide: a slide file is slides/<id>.html with an id of 1–64 letters, digits, _ or -`);
  }

  // The index.
  const deckText = files.get(DECK_FILE);
  let index: DeckIndex | undefined;
  if (deckText === undefined) {
    add(DECK_FILE, 'error', 'project/deck.json is missing.');
  } else {
    const parsed = parseDeckIndex(deckText);
    if (parsed.error) add(DECK_FILE, 'error', parsed.error);
    else index = parsed.index;
  }
  if (index) {
    for (const problem of checkDeckIndex(index, slideIds)) {
      add(DECK_FILE, problem.level === 'note' ? 'info' : problem.level, problem.message.replace(/^project\/deck\.json: /, ''));
    }
    for (const face of Object.values(index.faces)) {
      if (face.src !== undefined && options.exists && !options.exists(face.src)) add(DECK_FILE, 'warning', `face "${face.family}" src ${face.src} does not exist`);
    }
  }

  // A source deck reads its slides against project/deck.css, at the deck's size (passed with the deck: the check
  // runs in a type server that serves many decks at once, so it never sets the module's SLIDE_WIDTH, which is the
  // one deck an editor page shows).
  let deck: SourceDeck | undefined;
  if (index && deckFormatKind(index) === 'source') {
    const css = files.get(DECK_CSS_FILE);
    if (css === undefined) add(DECK_FILE, 'error', 'deck.json has a "format" key but project/deck.css is missing: send it with the index.');
    deck = createSourceDeck(css, index.size);
    for (const drop of deck.sheet.drops) add(DECK_CSS_FILE, 'warning', drop.what, drop.line);
  } else if (files.has(DECK_CSS_FILE)) {
    add(DECK_CSS_FILE, 'info', 'project/deck.css does nothing in a deck without a "format" key.');
  }
  const places = new Map((index ? resolveOrder(index.order, slideIds) : [...slideIds].sort()).map((id, i) => [id, i]));

  // Every slide.
  const faces = index ? Object.values(index.faces).map((face) => face.family) : [];
  let cells = 0;
  const lints = options.lints ?? true;
  for (const id of [...slideIds].sort()) {
    const file = `${SLIDES_FOLDER}${id}.html`;
    const source = files.get(file) ?? '';
    const bytes = new TextEncoder().encode(source).length;
    if (bytes > LIMITS.slideFileBytes) {
      add(file, 'error', `${Math.round(bytes / 1024)} KB — a slide file is at most ${LIMITS.slideFileBytes / 1024} KB`);
      continue;
    }
    const sourceSlide = deck !== undefined && !isFlatSlideHtml(source);
    const result = sourceSlide
      ? readSourceSlide(source, deck!, { id, faces, lints, index: places.get(id) ?? 0 })
      : compileSlide(source, { id, faces, lints });
    if (!deck && index && slideMarkupMadeFor(source) === 'sheet') add(file, 'warning', NEEDS_FORMAT_KEY);
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.level === 'lint' && !lints) continue;
      add(file, projectLevel(diagnostic.level), diagnostic.message, diagnostic.line);
    }
    if (result.slide.section !== undefined && index) {
      add(file, 'info', `data-section on slide "${id}" is moved into deck.json "sections" on the next open`);
    }
    if (options.exists) {
      for (const ref of result.assets) {
        if (!options.exists(ref)) add(file, 'warning', `slide "${id}" references ${ref}, which does not exist`);
      }
    }
    cells += result.cells;
  }
  if (cells > LIMITS.deckCells) add(DECK_FILE, 'error', `${cells} table cells across the deck — at most ${LIMITS.deckCells}`);
  if (slideIds.size === 0 && index) add(DECK_FILE, 'info', 'The deck has no slides yet: write project/slides/<id>.html.');
  return out;
}
