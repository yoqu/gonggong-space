import type { StageFace, StageFaces } from '../protocol.ts';

export type StackName = 'sans' | 'serif' | 'mono' | 'display';

const SYSTEM_STACKS: Record<Exclude<StackName, 'display'>, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

/** `kit.fonts`: one object for the whole load, so a film that kept a reference reads the stacks as filled. */
export const fontFamilies: Record<StackName, string> = { ...SYSTEM_STACKS, display: '' };
/** The stacks a face was named for (by the film's scenes.json fonts or a person's choice). */
let filled: StackName[] = [];

type Probe = string | [string, string];
const probes: Probe[] = [];
let fontCss = '';
let fontStyle: HTMLStyleElement | null = null;

export const fontFaceCss = (): string => fontCss;

/** The `<style>` on the stage that holds the faces; it follows every face added later. */
export function attachFontStyle(style: HTMLStyleElement): void {
  fontStyle = style;
  style.textContent = fontCss;
}

/** A face with a unicode-range loads only for text in it, so a probe may carry its sample text. */
function loadFace(probe: Probe): Promise<unknown> {
  const loading = typeof probe === 'string' ? document.fonts.load(probe) : document.fonts.load(probe[0], probe[1]);
  return loading.catch(() => null);
}

// Each field is matched before it is joined into CSS: fetched faces come from outside.
const FACE_FIELDS = {
  family: /^[A-Za-z0-9 _-]{1,64}$/,
  url: /^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/,
  weight: /^[0-9]{1,4}(?: [0-9]{1,4})?$/,
  style: /^(?:normal|italic)$/,
  range: /^(?:U\+[0-9A-F]{1,6}(?:-[0-9A-F]{1,6})?(?:,(?=U)|$))*$/,
} as const;

export function usableFaces(list: readonly StageFace[] | undefined): StageFace[] {
  return (list ?? []).filter(
    (face) =>
      FACE_FIELDS.family.test(face.family) &&
      FACE_FIELDS.url.test(face.url) &&
      FACE_FIELDS.weight.test(face.weight) &&
      FACE_FIELDS.style.test(face.style) &&
      (face.range === undefined || FACE_FIELDS.range.test(face.range)),
  );
}

/** Faces from the page, shipped or fetched, beside the film's own font assets. Resolves once all are loaded. */
export function addFonts(list: readonly StageFace[] | undefined): Promise<unknown[]> {
  const had = fontCss;
  const loads = usableFaces(list).map((face) => {
    const rule =
      `\n@font-face{font-family:"${face.family}";src:url(${face.url}) format("woff2");font-weight:${face.weight};font-style:${face.style}` +
      (face.range ? ';unicode-range:' + face.range : '') +
      (face.box ? `;ascent-override:${Number(face.box[0])}%;descent-override:${Number(face.box[1])}%;line-gap-override:0%` : '') +
      ';font-display:block}';
    const probe: Probe = [
      `${face.style} ${face.weight.split(' ')[0]} 16px "${face.family}"`,
      typeof face.sample === 'string' && face.sample.length <= 2 ? face.sample : ' ',
    ];
    if (fontCss.indexOf(rule) < 0) {
      fontCss += rule;
      probes.push(probe);
    }
    return probe;
  });
  if (fontStyle && fontCss !== had) fontStyle.textContent = fontCss;
  return Promise.all(loads.map(loadFace));
}

/** A font asset is a face named by its file's stem: `BrandSans-700.woff2` is "BrandSans-700". */
export function addFontAsset(name: string, url: string): void {
  const family = name.replace(/\.[a-z0-9]+$/i, '').replace(/["\\]/g, '');
  fontCss += `\n@font-face{font-family:"${family}";src:url(${url});font-display:block}`;
  probes.push(`16px "${family}"`);
}

export function resetFonts(): void {
  fontCss = '';
  probes.length = 0;
}

/** The film's faces, and a person's, go to the heads of their stacks before the cut reads them. */
export function fillStacks(faces: StageFaces | null): void {
  filled = [];
  fontFamilies.sans = SYSTEM_STACKS.sans;
  fontFamilies.serif = SYSTEM_STACKS.serif;
  fontFamilies.mono = SYSTEM_STACKS.mono;
  if (faces) {
    void addFonts(faces.fonts);
    const slots = faces.slots;
    filled = (['sans', 'serif', 'mono', 'display'] as const).filter((stack) => typeof slots[stack] === 'string');
    // Sans first: a headline's face falls back to the film's own sans.
    for (const stack of filled) {
      const family = (slots[stack] ?? '').replace(/["\\]/g, '');
      fontFamilies[stack] = `"${family}", ` + (stack === 'display' ? fontFamilies.sans : SYSTEM_STACKS[stack]);
    }
  }
  // Headlines with no face of their own: the sans stack with its first family twice. It draws alike, and words that
  // wear it written out can still be told from words in the sans stack.
  if (!filled.includes('display')) fontFamilies.display = (/^("[^"]*"|[^,]*)/.exec(fontFamilies.sans)?.[0] ?? '') + ', ' + fontFamilies.sans;
}

/**
 * The stacks for a css module, which cannot read the kit: var(--sans) always, and the others where a face fills
 * them. In :where(:root), so that a film's own property of the name wins.
 */
export function stackCss(): string {
  const stacks: StackName[] = ['sans', ...filled.filter((stack) => stack !== 'sans')];
  return ':where(:root){' + stacks.map((stack) => `--${stack}:${fontFamilies[stack]}`).join(';') + '}';
}

/** Waits for every face to be in, before init() measures anything. */
export async function fontsIn(): Promise<void> {
  try {
    await Promise.all(probes.map(loadFace));
    await document.fonts.ready;
  } catch {
    // No font loading API: carry on.
  }
}
