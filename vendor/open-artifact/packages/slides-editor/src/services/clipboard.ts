/**
 * Copy, cut and paste of slides and elements.
 *
 * What is copied travels as slide HTML (the file format itself), so a paste
 * into another deck re-compiles and re-validates it. The system clipboard
 * gets `text/html` carrying the payload in a `data-open-artifact-clipboard` attribute
 * plus plain text; a copy kept in memory covers browsers that drop custom
 * HTML. Pasting files places pictures and clips; pasting a video link adds
 * the clip; other text becomes a text box.
 */

import {
  compileSlide,
  isPinned,
  nodeText,
  pinnedRectOf,
  pxValue,
  serializeNode,
  serializeSlide,
  type Slide,
  type SlideNode,
} from '@open-artifact/slides-core';
import { toast } from '@open-artifact/ui';
import { useDeck } from '../state/deck.ts';
import { useView } from '../state/view.ts';
import { placeFiles, insertVideoLink } from './assets.ts';
import { canChange, centeredRect, currentSlide, deleteSelection, deleteSlides, insertPinned, insertSlides, insertTextBox, selectedPaths, targetSlides } from './commands.ts';
import { newTextBox, nodeAt, plainRuns } from '@open-artifact/slides-core';

/** Where keyboard copy / paste acts: the slide list or the slide on stage. */
export type ClipboardRegion = 'slides' | 'stage';

let region: ClipboardRegion = 'stage';

/** Sets where copy / paste acts (the rail and grid set `slides`, the stage `stage`). */
export function setClipboardRegion(next: ClipboardRegion): void {
  region = next;
}

/** The current copy / paste region. */
export function clipboardRegion(): ClipboardRegion {
  return useView.getState().mode === 'edit' ? region : 'slides';
}

/** What the clipboard carries. */
type Payload =
  | { openArtifact: 'slides'; v: 1; kind: 'slides'; slides: string[] }
  | { openArtifact: 'slides'; v: 1; kind: 'elements'; from: string; nodes: string[] };

let memory: Payload | null = null;

const escapeAttr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Builds the payload of the current selection. */
function currentPayload(): { payload: Payload; text: string } | null {
  if (clipboardRegion() === 'slides') {
    const deck = useDeck.getState();
    const slides = targetSlides()
      .map((id) => deck.slides[id])
      .filter((entry) => entry && !entry.held)
      .map((entry) => entry!.slide);
    if (slides.length === 0) return null;
    return { payload: { openArtifact: 'slides', v: 1, kind: 'slides', slides: slides.map((s) => serializeSlide(s)) }, text: slides.map((s) => s.id).join('\n') };
  }
  const slide = currentSlide();
  const paths = selectedPaths().filter((p, _, all) => !all.some((q) => q.length < p.length && q.every((n, i) => p[i] === n)));
  if (!slide || paths.length === 0) return null;
  const nodes = paths.map((p) => nodeAt(slide, p)).filter((n): n is SlideNode => Boolean(n));
  return {
    payload: { openArtifact: 'slides', v: 1, kind: 'elements', from: slide.id, nodes: nodes.map((n) => serializeNode(n)) },
    text: nodes.map(nodeText).filter(Boolean).join('\n'),
  };
}

/** Writes the payload into a clipboard event. */
function write(event: ClipboardEvent, payload: Payload, text: string): void {
  memory = payload;
  if (!event.clipboardData) return;
  event.clipboardData.setData('text/plain', text);
  event.clipboardData.setData('text/html', `<div data-open-artifact-clipboard="${escapeAttr(JSON.stringify(payload))}">${escapeAttr(text)}</div>`);
  event.preventDefault();
}

/** Reads our payload from pasted HTML. */
function readPayload(html: string): Payload | null {
  if (!html.includes('data-open-artifact-clipboard')) return null;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const raw = doc.querySelector('[data-open-artifact-clipboard]')?.getAttribute('data-open-artifact-clipboard');
    const value = raw ? (JSON.parse(raw) as Payload) : null;
    return value && value.openArtifact === 'slides' && value.v === 1 ? value : null;
  } catch {
    return null;
  }
}

/** True when the event target edits text itself (inputs, text editing). */
function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.closest?.('[contenteditable="true"]')));
}

/** Compiles pasted slides under fresh compile (ids are made unique on insert). */
function compileSlides(sources: readonly string[]): Slide[] {
  const faces = Object.values(useDeck.getState().index.faces).map((f) => f.family.toLowerCase());
  return sources
    .map((source) => compileSlide(source, { faces: new Set(faces), lints: false }))
    .filter((result) => !result.diagnostics.some((d) => d.level === 'error'))
    .map((result) => result.slide);
}

/** Compiles pasted element markup into nodes. */
function compileNodes(sources: readonly string[]): SlideNode[] {
  const faces = Object.values(useDeck.getState().index.faces).map((f) => f.family.toLowerCase());
  const result = compileSlide(`<section id="paste">${sources.join('\n')}</section>`, { faces: new Set(faces), lints: false });
  return result.slide.children;
}

/** Pastes a payload. */
function pastePayload(payload: Payload): void {
  if (payload.kind === 'slides') {
    const slides = compileSlides(payload.slides);
    if (slides.length === 0) return;
    const after = targetSlides().slice(-1)[0] ?? useView.getState().current;
    const ids = insertSlides(slides, after, slides.length === 1 ? 'Paste slide' : `Paste ${slides.length} slides`);
    if (ids.length > 1) toast.add({ title: `Pasted ${ids.length} slides` });
    return;
  }
  const slide = currentSlide();
  if (!slide) return;
  const sameSlide = payload.from === slide.id;
  const nodes = compileNodes(payload.nodes).map((node) => {
    if (isPinned(node)) {
      const r = pinnedRectOf(node);
      return r && sameSlide ? ({ ...node, style: { ...node.style, left: pxValue(r.x + 24), top: pxValue(r.y + 24) } } as SlideNode) : node;
    }
    // Flow elements become pinned copies centered on the slide.
    const rect = centeredRect(Number.parseFloat(node.style.width ?? '') || 800, Number.parseFloat(node.style.height ?? '') || 200);
    return { ...node, style: { ...node.style, position: 'absolute', left: pxValue(rect.x), top: pxValue(rect.y), width: pxValue(rect.w), height: pxValue(rect.h) } } as SlideNode;
  });
  insertPinned(nodes.length === 1 ? 'Paste' : `Paste ${nodes.length} elements`, nodes);
}

/** Pastes plain text: a video link becomes a clip, anything else a text box. */
function pasteText(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (/^https?:\/\/\S+$/.test(trimmed) && insertVideoLink(trimmed)) return;
  const lines = trimmed.split(/\r?\n/).length;
  const box = newTextBox(centeredRect(1100, Math.min(800, 80 + lines * 56)), '', { 'font-size': '40px' });
  const node = { ...box, blocks: [{ kind: 'text' as const, tag: 'p' as const, style: {}, runs: plainRuns(trimmed.slice(0, 20000)) }] };
  insertPinned('Paste text', [node]);
}

/** Installs the document copy / cut / paste handlers. Returns the uninstaller. */
export function installClipboard(): () => void {
  const onCopy = (event: ClipboardEvent): void => {
    if (document.querySelector('[aria-modal="true"]') || inTextField(event.target) || useView.getState().presenting) return;
    const current = currentPayload();
    if (current) write(event, current.payload, current.text);
  };
  const onCut = (event: ClipboardEvent): void => {
    if (document.querySelector('[aria-modal="true"]') || inTextField(event.target) || useView.getState().presenting || !canChange()) return;
    const current = currentPayload();
    if (!current) return;
    write(event, current.payload, current.text);
    if (current.payload.kind === 'slides') deleteSlides(targetSlides());
    else deleteSelection();
  };
  const onPaste = (event: ClipboardEvent): void => {
    if (document.querySelector('[aria-modal="true"]') || inTextField(event.target) || useView.getState().presenting || !canChange()) return;
    const data = event.clipboardData;
    if (!data) return;
    const files = Array.from(data.files);
    if (files.length) {
      event.preventDefault();
      void placeFiles(files);
      return;
    }
    const payload = readPayload(data.getData('text/html'));
    if (payload) {
      event.preventDefault();
      pastePayload(payload);
      return;
    }
    const text = data.getData('text/plain');
    if (text) {
      event.preventDefault();
      if (memory && text === currentPayloadText(memory)) pastePayload(memory);
      else pasteText(text);
    }
  };
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
  };
}

/** The plain text a payload was copied with (to match a paste that lost its HTML). */
function currentPayloadText(payload: Payload): string {
  if (payload.kind === 'slides') return compileSlides(payload.slides).map((s) => s.id).join('\n');
  return compileNodes(payload.nodes).map(nodeText).filter(Boolean).join('\n');
}

/** Menu Paste (no clipboard event): uses the copy kept in memory. */
export function pasteFromMemory(): boolean {
  if (!memory || !canChange()) return false;
  pastePayload(memory);
  return true;
}

/** True when a copy is kept in memory (enables the Paste menu items). */
export function hasMemory(kind?: Payload['kind']): boolean {
  return Boolean(memory && (!kind || memory.kind === kind));
}

/** Menu Copy for slides (no clipboard event): keeps the copy and writes plain text. */
export function copySlidesToMemory(ids: readonly string[]): void {
  const deck = useDeck.getState();
  const slides = ids.map((id) => deck.slides[id]).filter((e) => e && !e.held).map((e) => e!.slide);
  if (slides.length === 0) return;
  memory = { openArtifact: 'slides', v: 1, kind: 'slides', slides: slides.map((s) => serializeSlide(s)) };
  toast.add({ title: slides.length === 1 ? 'Slide copied' : `${slides.length} slides copied` });
}

/** Inserts a text box (the T tool's click without a drag). */
export { insertTextBox };
