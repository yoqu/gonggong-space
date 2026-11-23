/**
 * HTML export: one self-contained page that presents the deck.
 *
 * Every slide is rendered offscreen and its fitted markup copied as it is
 * (text already shrunk to fit, so the page needs no layout code), with the
 * slide stylesheet, the page reset and the build keyframes. Pictures,
 * uploaded clips and fonts are inlined as `data:` URLs while they fit the
 * budgets; larger files stay links to the deck online. Embedded pages run
 * again in sandboxed frames; hosted videos load their player while their
 * slide shows. The built-in player (player.ts) scales and plays the deck.
 */

import { nodeAt, parsePathKey, SLIDE_HEIGHT, SLIDE_WIDTH, videoEmbedUrl, type ImageNode } from '@open-artifact/slides-core';
import type { HtmlQuality } from '../exports.ts';
import { BUILD_MS, slideStylesheet } from '../../render/css.ts';
import { fontFaceRule } from '../../render/fonts.ts';
import { embedDocument } from '../../render/embed-still.ts';
import { mountSlide, PAGE_RESET } from '../capture.ts';
import { currentSourceDeck } from '../../state/deck.ts';
import { elementMotion, readMotionRules } from '../motion.ts';
import { buildSteps, TRANSITION_MS } from '../present.ts';
import { blobToDataUrl, shrinkPicture } from '@open-artifact/export-kit';
import { deckFontCss, deckText } from './fonts.ts';
import { breathe, type ExportJob, type ExportSlide } from './job.ts';
import { PLAYER_CSS, PLAYER_SCRIPT, READER_CSS } from './player.ts';

/** Largest single file inlined, bytes. */
const MAX_INLINE_FILE = 10 * 1024 * 1024;
/** Most bytes of pictures and clips inlined in one page. */
const MAX_INLINE_TOTAL = 120 * 1024 * 1024;
/** Most bytes of fonts inlined in one page. */
const MAX_FONT_BYTES = 8 * 1024 * 1024;

/**
 * How much smaller pictures get at each setting: the long edge at most
 * `scale` times the size the picture is shown at on its slide, re-encoded at
 * `quality`. Best keeps every file as it is.
 */
export const HTML_IMAGE_TIERS: Record<Exclude<HtmlQuality, 'best'>, { scale: number; quality: number }> = {
  better: { scale: 1.5, quality: 0.8 },
  good: { scale: 1, quality: 0.72 },
};

/** Smallest long edge a shrunk picture keeps, px. */
const MIN_SHRINK_EDGE = 256;

const PLAY_ICON =
  '<svg width="72" height="72" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/></svg>';

/** Escapes text for HTML. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Turns asset references into `data:` URLs within the budgets, or into absolute links. */
class Inliner {
  private bytes = 0;
  /** Address (and size it is shrunk to) → what was written and how. */
  private readonly done = new Map<string, { url: string; how: 'inlined' | 'online' | 'missing' | 'foreign' }>();

  private readonly job: ExportJob;
  private readonly quality: HtmlQuality;

  constructor(job: ExportJob, quality: HtmlQuality) {
    this.job = job;
    this.quality = quality;
  }

  /**
   * The address to write for a file the slide shows. Files that cannot be
   * inlined stay links, noted as `online` for the slide; unreadable files
   * of the deck are noted as missing pictures. Below best quality a picture
   * is shrunk to the size it is shown at (`shown`, its long edge in slide
   * px; the slide's when unknown) before it is inlined.
   */
  async url(src: string, slide: number, online: 'pictureOnline' | 'videoOnline', shown?: number): Promise<string> {
    if (!src || src.startsWith('data:')) return src;
    const assets = this.job.capture.assets;
    const absolute = assets.url(src);
    const tier = online === 'pictureOnline' && this.quality !== 'best' ? HTML_IMAGE_TIERS[this.quality] : undefined;
    const edge = tier ? Math.max(MIN_SHRINK_EDGE, Math.ceil((shown && shown > 0 ? shown : Math.max(SLIDE_WIDTH, SLIDE_HEIGHT)) * tier.scale)) : 0;
    const key = tier ? `${absolute} ${edge}` : absolute;
    let result = this.done.get(key);
    if (!result) {
      const foreign = /^https?:/i.test(absolute) && new URL(absolute).origin !== location.origin;
      const original = await assets.blob(src);
      result = { url: absolute, how: original ? 'online' : foreign ? 'foreign' : 'missing' };
      const blob = original && tier ? ((await shrinkPicture(original, edge, tier.quality).catch(() => null)) ?? original) : original;
      if (blob && blob.size <= MAX_INLINE_FILE && this.bytes + blob.size <= MAX_INLINE_TOTAL) {
        const data = blob === original ? await assets.dataUrl(src) : await blobToDataUrl(blob).catch(() => null);
        if (data) {
          this.bytes += blob.size;
          result = { url: data, how: 'inlined' };
        }
      }
      this.done.set(key, result);
    }
    if (result.how === 'online') this.job.notes.add(online, slide);
    else if (result.how === 'missing') this.job.notes.add('picture', slide);
    return result.url;
  }
}

/** The long edge an element is shown at, in slide px (layout size, so the offscreen scale does not count). */
function shownEdge(el: Element | undefined): number | undefined {
  if (!(el instanceof HTMLElement)) return undefined;
  const edge = Math.max(el.offsetWidth, el.offsetHeight);
  return edge > 0 ? edge : undefined;
}

/** Replaces `url(…)` references in an element's inline style. */
async function inlineStyle(el: Element, inliner: Inliner, slide: number, shown?: number): Promise<void> {
  const style = el.getAttribute('style');
  if (!style || !style.includes('url(')) return;
  let next = style;
  for (const match of style.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    const raw = match[2]!.replace(/&quot;/g, '');
    if (raw.startsWith('data:')) continue;
    next = next.replace(match[0], `url("${await inliner.url(raw, slide, 'pictureOnline', shown)}")`);
  }
  el.setAttribute('style', next);
}

/** Turns a video frame's poster into a playable clip (or a hosted player's holder). */
async function videoFrame(frame: HTMLElement, node: ImageNode, entry: ExportSlide, inliner: Inliner, job: ExportJob): Promise<void> {
  const video = node.video!;
  const poster = Array.from(frame.children).find((child): child is HTMLImageElement => child instanceof HTMLImageElement) ?? null;
  frame.setAttribute('data-open-artifact-media', '');
  frame.setAttribute('data-open-artifact-start', video.startOnClick ? 'click' : 'auto');
  if (video.delay && !video.startOnClick) frame.setAttribute('data-open-artifact-delay', String(video.delay));
  if (video.src) {
    const clip = frame.ownerDocument.createElement('video');
    clip.setAttribute('data-open-artifact-clip', '');
    clip.setAttribute('src', await inliner.url(video.src, entry.number, 'videoOnline'));
    clip.setAttribute('playsinline', '');
    clip.setAttribute('preload', 'auto');
    if (!video.sound) clip.setAttribute('muted', '');
    if (video.loop !== false) clip.setAttribute('loop', '');
    if (poster) {
      const src = poster.getAttribute('src');
      if (src) clip.setAttribute('poster', src);
      const style = poster.getAttribute('style');
      if (style) clip.setAttribute('style', style);
      poster.replaceWith(clip);
    } else {
      clip.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover');
      frame.prepend(clip);
    }
  } else if (video.link) {
    const url = videoEmbedUrl(video.link);
    if (url) {
      frame.setAttribute('data-open-artifact-hosted', url);
      job.notes.add('hostedVideo', entry.number);
    }
  }
  if (node.alt) frame.setAttribute('aria-label', node.alt);
  if (video.startOnClick) {
    const button = frame.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'open-artifact-play';
    button.setAttribute('aria-label', 'Play video');
    button.innerHTML = PLAY_ICON;
    frame.appendChild(button);
  }
}

/** The plan of one slide for the player. */
interface SlidePlan {
  transition?: string;
  builds: { child: number; enters: boolean }[];
  steps: { enter: number[]; exit: number[]; auto: boolean }[];
}

/** One slide's markup, ready for the page. */
async function slideMarkup(entry: ExportSlide, job: ExportJob, inliner: Inliner, rules: ReturnType<typeof readMotionRules>): Promise<{ html: string; plan: SlidePlan; keyframes: string }> {
  const slide = entry.slide;
  const mounted = await mountSlide(slide, job.capture, false);
  try {
    const copy = mounted.root.cloneNode(true) as HTMLElement;
    copy.setAttribute('data-open-artifact-mode', 'present');
    // Pictures and backgrounds.
    // The clone keeps the mounted slide's element order, so sizes read from the original.
    const shownImgs = Array.from(mounted.root.querySelectorAll('img'));
    for (const [i, img] of Array.from(copy.querySelectorAll('img')).entries()) {
      img.removeAttribute('srcset');
      img.removeAttribute('loading');
      const src = img.getAttribute('src');
      if (src) img.setAttribute('src', await inliner.url(src, entry.number, 'pictureOnline', shownEdge(shownImgs[i])));
    }
    const shownStyled = Array.from(mounted.root.querySelectorAll('[style*="url("]'));
    for (const [i, el] of Array.from(copy.querySelectorAll('[style*="url("]')).entries()) await inlineStyle(el, inliner, entry.number, shownEdge(shownStyled[i]));
    await inlineStyle(copy, inliner, entry.number, shownEdge(mounted.root));
    for (const image of Array.from(copy.querySelectorAll<SVGImageElement>('svg image'))) {
      const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
      if (href && !href.startsWith('data:')) image.setAttribute('href', await inliner.url(href, entry.number, 'pictureOnline'));
    }
    // Links open in a new tab.
    for (const link of Array.from(copy.querySelectorAll('a[href]'))) {
      link.removeAttribute('tabindex');
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
    // Embedded pages run again.
    for (const still of Array.from(copy.querySelectorAll<HTMLElement>('.open-artifact-embed-still'))) {
      const node = nodeAt(slide, parsePathKey(still.getAttribute('data-open-artifact-path') ?? ''));
      if (node?.kind !== 'embed') continue;
      const frame = copy.ownerDocument.createElement('iframe');
      for (const name of ['data-open-artifact-path', 'data-open-artifact-kind', 'style']) {
        const value = still.getAttribute(name);
        if (value !== null) frame.setAttribute(name, value);
      }
      frame.className = still.className.replace(/\bopen-artifact-embed-still\b/, '').trim();
      frame.setAttribute('title', 'Embedded page');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('loading', 'lazy');
      frame.setAttribute('tabindex', '-1');
      frame.style.pointerEvents = 'none';
      frame.setAttribute('srcdoc', embedDocument(node.html));
      still.replaceWith(frame);
    }
    // Videos.
    for (const frame of Array.from(copy.querySelectorAll<HTMLElement>('[data-open-artifact-kind="image"]'))) {
      const node = nodeAt(slide, parsePathKey(frame.getAttribute('data-open-artifact-path') ?? ''));
      if (node?.kind === 'image' && node.video) await videoFrame(frame, node, entry, inliner, job);
    }
    // Pinned children: ids for magic move, effects for builds.
    for (const el of Array.from(copy.children)) {
      const key = el.getAttribute('data-open-artifact-path') ?? '';
      if (!/^\d+$/.test(key)) continue;
      const node = slide.children[Number(key)];
      if (!node) continue;
      if (node.id) el.setAttribute('data-open-artifact-id', node.id);
      if (node.buildIn) el.setAttribute('data-open-artifact-in', node.buildIn.effect);
      if (node.buildOut) el.setAttribute('data-open-artifact-out', node.buildOut.effect);
    }
    let keyframes = '';
    if (slide.motion) {
      const motion = slide.motion;
      const fragments = new Set(motion.fragments.map(fragment => fragment.origin));
      for (const element of [copy, ...copy.querySelectorAll<HTMLElement>('[data-open-artifact-path]')]) {
        const node = element === copy ? undefined : nodeAt(slide, parsePathKey(element.dataset.openArtifactPath ?? ''));
        const origin = element === copy ? 0 : node?.origin;
        if (origin === undefined) continue;
        if (fragments.has(origin)) element.dataset.fragment = String(origin);
        if (node?.buildIn || node?.buildOut || !(motion.elements[origin] || motion.starting[origin])) continue;
        const effect = elementMotion(motion.elements[origin] ?? {}, motion.starting[origin], rules, `oa-start-${entry.number}-${origin}`);
        if (effect.animation) element.dataset.animation = effect.animation;
        if (effect.count) element.dataset.count = JSON.stringify(effect.count);
        keyframes += effect.keyframes;
      }
    }
    const builds: SlidePlan['builds'] = [];
    slide.children.forEach((child, i) => {
      if (child.buildIn || child.buildOut) builds.push({ child: i, enters: Boolean(child.buildIn) });
    });
    const plan: SlidePlan = { transition: slide.transition, builds, steps: buildSteps(slide) };
    return { html: copy.outerHTML, plan, keyframes };
  } finally {
    mounted.dispose();
  }
}

/** The deck's fonts for the page: inlined within budget, else linked. */
async function pageFonts(job: ExportJob): Promise<string> {
  const faces = job.capture.faces;
  const bundle = await deckFontCss(faces, {
    text: deckText(job.slides.map((entry) => entry.slide)),
    assets: job.capture.assets,
    maxBytes: MAX_FONT_BYTES,
  });
  const parts: string[] = [];
  for (const href of bundle.links) parts.push(`<link rel="stylesheet" href="${escapeHtml(href)}">`);
  if (bundle.links.length) job.notes.add('fontsLinked');
  const rules = [bundle.css];
  for (const face of Object.values(faces)) {
    if (!face.src || !bundle.missing.includes(face.family)) continue;
    rules.push(fontFaceRule(face, job.capture.assets.url(face.src)));
    job.notes.text('Some uploaded fonts load from the deck online.');
  }
  parts.push(`<style>${rules.join('\n').replace(/<\/style/gi, '<\\/style')}</style>`);
  return parts.join('\n');
}

/** Writes the deck as a self-contained HTML page. */
export async function exportHtml(job: ExportJob, options: { quality: HtmlQuality } = { quality: 'best' }): Promise<Blob> {
  const inliner = new Inliner(job, options.quality);
  const fonts = await pageFonts(job);
  const motionCss = [...(currentSourceDeck()?.sheet.motion ?? [])];
  const rules = readMotionRules(motionCss);
  const frames: string[] = [];
  const plans: SlidePlan[] = [];
  for (const [index, entry] of job.slides.entries()) {
    job.begin(entry.number);
    const { html, plan, keyframes } = await slideMarkup(entry, job, inliner, rules);
    if (keyframes) motionCss.push(keyframes);
    frames.push(`<section class="open-artifact-frame${index === 0 ? ' open-artifact-on' : ''}" aria-roledescription="slide" aria-label="Slide ${index + 1}">${html}</section>`);
    plans.push(plan);
    job.progress(index + 1);
    await breathe();
  }
  if (frames.length === 0) throw new Error('There are no slides to export.');
  const plan = JSON.stringify({ buildMs: BUILD_MS, durations: TRANSITION_MS, slides: plans }).replace(/</g, '\\u003c');
  const readerStyle = `:root{--slide-aspect:${SLIDE_WIDTH}/${SLIDE_HEIGHT};--page-scale:calc(100vw / ${SLIDE_WIDTH}px)}
${READER_CSS}`;
  const page =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="generator" content="Open Artifact">\n' +
    `<title>${escapeHtml(job.title)}</title>\n` +
    `${fonts}\n` +
    `<style>${PAGE_RESET}\n${slideStylesheet()}\n${PLAYER_CSS.replaceAll('1920px', `${SLIDE_WIDTH}px`)}\n${readerStyle}\n${motionCss.join('\n').replace(/<\/style/gi, '<\\/style')}</style>\n` +
    `<noscript><style>${readerStyle.replaceAll('html.open-artifact-reader', 'html').replaceAll('.open-artifact-reader ', '')}</style></noscript>\n` +
    '</head>\n<body>\n' +
    `<main class="open-artifact-deck" aria-roledescription="slide deck" aria-label="${escapeHtml(job.title)}">\n${frames.join('\n')}\n</main>\n` +
    '<div class="open-artifact-hud" aria-hidden="true"></div>\n' +
    `<script type="application/json" id="open-artifact-plan">${plan}</script>\n` +
    `<script>${PLAYER_SCRIPT.replace('var W = 1920', `var W = ${SLIDE_WIDTH}`)}</script>\n` +
    '</body>\n</html>\n';
  return new Blob([page], { type: 'text/html;charset=utf-8' });
}
