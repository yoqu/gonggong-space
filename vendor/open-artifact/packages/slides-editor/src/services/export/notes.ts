/**
 * Export notes: the things an export could not carry over, told to the
 * person once per kind with the slides they concern ("Embedded pages became
 * placeholder pictures (slides 3 and 7)."). Also the text wrapping used to
 * lay out speaker notes on PDF pages.
 */

/** Every kind of note about slides (or the whole deck), with its message. */
export const NOTE_MESSAGES = {
  hidden: 'Hidden slides were left out',
  held: 'Slides with errors were left out',
  embed: 'Embedded pages became still pictures',
  embedPdf: 'Some embedded pages could not be captured and show as placeholders',
  video: 'Videos became their poster pictures',
  videoMissing: 'Videos without a poster picture became placeholders',
  videoOnline: 'Videos too large to include play from the deck online',
  hostedVideo: 'Hosted videos need an internet connection to play',
  picture: 'Some pictures could not be read and were left out',
  pictureOnline: 'Pictures too large to include load from the deck online',
  notesCut: 'Long speaker notes were cut to fit four pages',
  magic: 'Magic Move transitions became fades',
  builds: 'Build animations were left out: everything shows from the start',
  rotatedTable: 'Rotated tables were placed upright',
  listReversed: 'Lists that count down were numbered upward (PowerPoint numbering only counts up)',
  listStart: 'Lists that start below 1 were numbered from 1',
  listInside: 'List markers set inside the text were hung in the margin',
  backgroundPicture: 'Backgrounds PowerPoint cannot draw (pictures, patterns, radial or see-through gradients) became pictures',
  textGradient: 'Gradient-filled text took the gradient\u2019s first color (PowerPoint text here takes one color)',
  shadowInset: 'Inner shadows were left out (PowerPoint shapes carry outer shadows only)',
  shadowLayers: 'Only the first of several shadows on a shape was kept',
  shadowSpread: 'Shadow spread was left out (PowerPoint shadows do not grow)',
  borderDouble: 'Double borders became single lines',
  borderSides: 'Borders that differ from side to side became separate lines',
  blend: 'Blend modes were left out (PowerPoint has no equivalent)',
  filter: 'Blur and color filters on boxes were left out',
  fontsLinked: 'Fonts load from Google Fonts when the file is opened online',
  fontsMissing: 'Some fonts could not be included, so a fallback font shows instead',
  fontsNotEmbedded: 'Fonts are not embedded: PowerPoint uses installed fonts or substitutes',
  rasterFallback: 'Some slides were drawn with a simpler renderer, so effects may differ',
  pageLimit: 'The PDF reached its page limit, so the last slides were left out',
} as const;

export type NoteKind = keyof typeof NOTE_MESSAGES;

/** Kinds of note about font families (PowerPoint font embedding), with their message. */
export const FAMILY_NOTE_MESSAGES = {
  fontLicence: 'Not embedded because their licenses do not allow it, so a substitute shows where they are not installed',
  fontVariable: 'Not embedded because they are only published as variable fonts, which PowerPoint cannot embed',
  fontFormat: 'Not embedded because their files are not TrueType, the only kind PowerPoint embeds',
  fontBudget: 'Not embedded because they would make the file too large',
  fontBudgetAfter: 'Not embedded because there was no room left after the fonts used by more of the text',
  fontFetch: 'Not embedded because their files could not be downloaded',
  fontSlow: 'Not embedded because their files took too long to download; exporting again may carry them',
  fontPartial: 'Embedded for one script only: characters of other scripts show in a substitute font',
  fontStyles: 'Embedded without some of their bold or italic styles',
  fontLate: 'Had not finished loading when the slides were drawn, so some of their text may show in a fallback font; exporting again may help',
} as const;

export type FamilyNoteKind = keyof typeof FAMILY_NOTE_MESSAGES;

/** "3", "3 and 7", "3, 5 and 7". */
export function slideList(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length <= 1) return String(sorted[0] ?? '');
  return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

/** "Inter", "Inter and Lora", "Inter, Lora and Mono". */
export function nameList(names: readonly string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/** Collects notes during one export. */
export class ExportNotes {
  private readonly kinds = new Map<NoteKind, number[]>();
  private readonly families = new Map<FamilyNoteKind, string[]>();
  private readonly extra: string[] = [];

  /** Records a note of a kind, for a slide (by its number in the deck) or the whole deck. */
  add(kind: NoteKind, slide?: number): void {
    const list = this.kinds.get(kind) ?? [];
    if (slide !== undefined) list.push(slide);
    this.kinds.set(kind, list);
  }

  /** Records a note about a font family. */
  family(kind: FamilyNoteKind, family: string): void {
    const list = this.families.get(kind) ?? [];
    if (!list.includes(family)) list.push(family);
    this.families.set(kind, list);
  }

  /** Records a free-form note (shown once). */
  text(message: string): void {
    if (!this.extra.includes(message)) this.extra.push(message);
  }

  has(kind: NoteKind): boolean {
    return this.kinds.has(kind);
  }

  /**
   * The notes as sentences: slide notes in the order of {@link NOTE_MESSAGES},
   * then font notes, then the rest. A family already named by another font
   * note is left out of `fontLate`: that note says more.
   */
  list(): string[] {
    const out: string[] = [];
    for (const kind of Object.keys(NOTE_MESSAGES) as NoteKind[]) {
      const slides = this.kinds.get(kind);
      if (!slides) continue;
      const unique = [...new Set(slides)];
      const where = unique.length === 0 ? '' : ` (${unique.length === 1 ? 'slide' : 'slides'} ${slideList(unique)})`;
      out.push(`${NOTE_MESSAGES[kind]}${where}.`);
    }
    const named = new Set([...this.families].flatMap(([kind, names]) => (kind === 'fontLate' ? [] : names)));
    for (const kind of Object.keys(FAMILY_NOTE_MESSAGES) as FamilyNoteKind[]) {
      const names = kind === 'fontLate' ? this.families.get(kind)?.filter((name) => !named.has(name)) : this.families.get(kind);
      if (!names?.length) continue;
      out.push(`${nameList(names)}: ${FAMILY_NOTE_MESSAGES[kind].charAt(0).toLowerCase()}${FAMILY_NOTE_MESSAGES[kind].slice(1)}.`);
    }
    return [...out, ...this.extra];
  }
}

/** True for characters a line may break before or after (CJK and similar). */
function breaksAnywhere(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x20000 && code <= 0x3ffff)
  );
}

/**
 * Wraps text into lines no wider than `width` as measured by `measure`.
 * Explicit line breaks are kept (an empty line stays empty); words longer
 * than a line are broken between characters; CJK text breaks anywhere.
 */
export function wrapLines(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    // Tokens: runs of non-space (split further where CJK allows) with their trailing spaces.
    const tokens: string[] = [];
    for (const match of paragraph.matchAll(/\s*\S+\s*|\s+/g)) {
      let word = '';
      for (const char of match[0]) {
        if (breaksAnywhere(char)) {
          if (word) tokens.push(word);
          tokens.push(char);
          word = '';
        } else word += char;
      }
      if (word) tokens.push(word);
    }
    let line = '';
    const push = (): void => {
      lines.push(line.trimEnd());
      line = '';
    };
    for (const token of tokens) {
      const candidate = line + token;
      if (measure(candidate.trimEnd()) <= width) {
        line = candidate;
        continue;
      }
      // Start a new line (a line of only spaces is dropped).
      if (line.trim()) push();
      line = '';
      const rest = token.trimStart();
      if (measure(rest.trimEnd()) <= width) {
        line = rest;
        continue;
      }
      // A token longer than a whole line: break it between characters.
      for (const char of rest) {
        if (line && measure((line + char).trimEnd()) > width) push();
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Lines split into pages, and whether some were left over. */
export interface NotePages {
  pages: string[][];
  /** More lines than `maxPages` could hold. */
  cut: boolean;
}

/**
 * Splits wrapped lines into pages: `firstLines` fit on the first page,
 * `perPage` on each later one, at most `maxPages` pages. Trailing empty
 * lines are dropped.
 */
export function paginate(lines: readonly string[], firstLines: number, perPage: number, maxPages: number): NotePages {
  let end = lines.length;
  while (end > 0 && !lines[end - 1]!.trim()) end--;
  const pages: string[][] = [];
  let at = 0;
  while (at < end && pages.length < maxPages) {
    const take = pages.length === 0 ? firstLines : perPage;
    pages.push(lines.slice(at, Math.min(end, at + take)));
    at += take;
  }
  return { pages, cut: at < end };
}
