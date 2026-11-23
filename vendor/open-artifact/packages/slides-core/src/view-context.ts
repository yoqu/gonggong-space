/**
 * The Slides view context: what one viewer has on screen, published by the
 * editor so the agent can resolve "this slide" or "the selected box" without
 * guessing.
 *
 * Every string here is written by a viewer's browser and is data, never
 * instructions. The builder enforces the limits and grammars; the validator
 * is what a receiver runs before trusting a record: any listed field of the
 * wrong shape discards the whole record.
 */

import { CONTEXT_ID_PATTERN, truncate, type ContextKind } from './ids.ts';
import { ID_PATTERN, LIMITS } from './limits.ts';

/** Which face of the editor is up. */
export type ViewMode = 'edit' | 'grid' | 'present';

/** One labelled selected entry. */
export interface SelectionLabel {
  id: string;
  kind: ContextKind;
  label?: string;
}

/** The record the Slides editor publishes as `context`. */
export interface SlidesViewContext {
  mode: ViewMode;
  /** Null for a deck that is its own artifact. */
  deck: null | string;
  slideId: string | null;
  slideTitle?: string;
  /** 1-based; 0 = no slide on stage. */
  slideIndex: number;
  slideCount: number;
  dirty: boolean;
  /** Running count of this tab's hand edits. */
  edits?: number;
  selected: string[];
  selection?: SelectionLabel[];
  /** Present only while the slide on stage is held read-only. */
  slideHeld?: true;
  slideHeldWhy?: string;
  /** `edit` with several slides selected in the rail: their ids in deck order. */
  selectedSlides?: string[];
  /** How many slides are selected (rail multi-select in `edit`; the grid selection in `grid`). */
  selectedCount?: number;
  /** `grid`: keys of the selected sections. */
  sections?: string[];
  /** `grid`: for each `selected` slide, its section key (`-` = the opening run). */
  slideSections?: string[];
  /** `grid`: the section whose description is being typed (`-` = the opening run's). */
  editingSection?: string | null;
}

/** Editor state the record is built from. */
export interface ViewContextInput {
  mode: ViewMode;
  slideId: string | null;
  slideTitle?: string;
  slideIndex: number;
  slideCount: number;
  dirty: boolean;
  edits?: number;
  /** Selected entries in `edit` (element context ids) or `grid` (slide ids), most recent last. */
  selected: readonly { id: string; kind: ContextKind; label?: string }[];
  held?: string;
  /** `edit`: slides selected in the rail when more than one. */
  selectedSlides?: readonly string[];
  /** `grid`: total of selected slides. */
  gridSelectedCount?: number;
  /** `grid`: selected section keys. */
  sections?: readonly string[];
  /** `grid`: the section key of each selected slide. */
  slideSections?: readonly string[];
  editingSection?: string | null;
}

const SECTION_KEY = /^(?:[A-Za-z0-9_-]{1,64}|-)$/;

/** Builds the record from editor state. */
export function buildViewContext(input: ViewContextInput): SlidesViewContext {
  const present = input.mode === 'present';
  const selected = present ? [] : input.selected.filter((entry) => CONTEXT_ID_PATTERN.test(entry.id)).slice(-LIMITS.contextSelected);
  const record: SlidesViewContext = {
    mode: input.mode,
    deck: null,
    slideId: input.slideId !== null && ID_PATTERN.test(input.slideId) ? input.slideId : null,
    slideIndex: Math.max(0, Math.floor(input.slideIndex)),
    slideCount: Math.max(0, Math.floor(input.slideCount)),
    dirty: input.dirty,
    selected: selected.map((entry) => entry.id),
  };
  if (input.slideTitle) record.slideTitle = truncate(input.slideTitle.replace(/\s+/g, ' ').trim(), 60);
  if (typeof input.edits === 'number') record.edits = input.edits;
  if (selected.length) {
    record.selection = selected.slice(-LIMITS.contextSelection).map(({ id, kind, label }) => {
      const text = label ? truncate(label.replace(/\s+/g, ' ').trim(), 60) : '';
      return text ? { id, kind, label: text } : { id, kind };
    });
  }
  if (input.held !== undefined) {
    record.slideHeld = true;
    record.slideHeldWhy = truncate(input.held.replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim(), 60);
  }
  if (input.mode === 'edit' && input.selectedSlides && input.selectedSlides.length > 1) {
    record.selected = [];
    delete record.selection;
    record.selectedSlides = input.selectedSlides.filter((id) => ID_PATTERN.test(id)).slice(-LIMITS.contextSelected);
    record.selectedCount = input.selectedSlides.length;
  }
  if (input.mode === 'grid') {
    record.sections = (input.sections ?? []).filter((key) => ID_PATTERN.test(key)).slice(-LIMITS.contextSelected);
    record.slideSections = (input.slideSections ?? []).slice(-record.selected.length || 0).filter((key) => SECTION_KEY.test(key));
    if (record.slideSections.length !== record.selected.length) record.slideSections = [];
    record.selectedCount = input.gridSelectedCount ?? record.selected.length;
    record.editingSection = input.editingSection !== undefined && input.editingSection !== null && SECTION_KEY.test(input.editingSection) ? input.editingSection : null;
  }
  return shrink(record);
}

/** Drops labels, then selection entries, until the record fits its byte budget. */
function shrink(record: SlidesViewContext): SlidesViewContext {
  const size = (): number => new TextEncoder().encode(JSON.stringify(record)).length;
  if (size() <= LIMITS.contextBytes) return record;
  if (record.selection) record.selection = record.selection.map(({ id, kind }) => ({ id, kind }));
  while (size() > LIMITS.contextBytes && record.selection?.length) record.selection.shift();
  if (record.selection?.length === 0) delete record.selection;
  while (size() > LIMITS.contextBytes && record.selected.length) {
    record.selected.shift();
    record.slideSections?.shift();
  }
  return record;
}

const KINDS = new Set<ContextKind>(['text', 'img', 'icon', 'shape', 'table', 'html', 'spacer', 'stack', 'grid', 'overlay', 'slide', 'section', 'cell']);
const isList = (value: unknown, max: number, pattern: RegExp): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string' && pattern.test(item));
const isShortText = (value: unknown): boolean => typeof value === 'string' && value.length <= 80;

/**
 * Validates a received record. Returns it when every listed field has its
 * shape (unknown keys are ignored), `null` to discard it.
 */
export function validateViewContext(value: unknown): SlidesViewContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (JSON.stringify(value).length > LIMITS.contextBytes * 2) return null;
  const r = value as Record<string, unknown>;
  if (r.mode !== 'edit' && r.mode !== 'grid' && r.mode !== 'present') return null;
  if (r.deck !== null && !(typeof r.deck === 'string' && ID_PATTERN.test(r.deck))) return null;
  if (r.slideId !== null && !(typeof r.slideId === 'string' && ID_PATTERN.test(r.slideId))) return null;
  if (r.slideTitle !== undefined && !isShortText(r.slideTitle)) return null;
  for (const key of ['slideIndex', 'slideCount'] as const) {
    if (!(typeof r[key] === 'number' && Number.isInteger(r[key]) && (r[key] as number) >= 0)) return null;
  }
  if (typeof r.dirty !== 'boolean') return null;
  if (r.edits !== undefined && !(typeof r.edits === 'number' && Number.isInteger(r.edits) && r.edits >= 0)) return null;
  const selectedPattern = r.mode === 'grid' ? ID_PATTERN : CONTEXT_ID_PATTERN;
  if (!isList(r.selected, LIMITS.contextSelected, selectedPattern)) return null;
  if (r.mode === 'present' && (r.selected as string[]).length > 0) return null;
  if (r.selection !== undefined) {
    if (!Array.isArray(r.selection) || r.selection.length > LIMITS.contextSelection) return null;
    const ids = new Set([...(r.selected as string[]), ...(Array.isArray(r.sections) ? (r.sections as string[]) : [])]);
    for (const entry of r.selection as unknown[]) {
      if (!entry || typeof entry !== 'object') return null;
      const { id, kind, label } = entry as Record<string, unknown>;
      if (typeof id !== 'string' || !ids.has(id)) return null;
      if (typeof kind !== 'string' || !KINDS.has(kind as ContextKind)) return null;
      if (label !== undefined && !isShortText(label)) return null;
    }
  }
  if (r.slideHeld !== undefined && r.slideHeld !== true) return null;
  if (r.slideHeldWhy !== undefined && !isShortText(r.slideHeldWhy)) return null;
  if (r.selectedSlides !== undefined && !isList(r.selectedSlides, LIMITS.contextSelected, ID_PATTERN)) return null;
  if (r.selectedCount !== undefined && !(typeof r.selectedCount === 'number' && Number.isInteger(r.selectedCount) && r.selectedCount >= 0)) return null;
  if (r.sections !== undefined && !isList(r.sections, LIMITS.contextSelected, ID_PATTERN)) return null;
  if (r.slideSections !== undefined && !isList(r.slideSections, LIMITS.contextSelected, SECTION_KEY)) return null;
  if (r.editingSection !== undefined && r.editingSection !== null && !(typeof r.editingSection === 'string' && SECTION_KEY.test(r.editingSection))) return null;
  return r as unknown as SlidesViewContext;
}

/** Longest "ask the agent to fix" request. */
export const FIX_REQUEST_LIMIT = 1800;

/**
 * The text of an "Ask agent to fix" request for held slides: each slide id
 * and its error messages, cut to {@link FIX_REQUEST_LIMIT} characters. The
 * caller fences it as untrusted data before it reaches a prompt.
 */
export function buildFixRequest(errors: readonly { slide: string; messages: readonly string[] }[]): string {
  const lines: string[] = [];
  for (const { slide, messages } of errors) {
    lines.push(`project/slides/${slide}.html:`);
    for (const message of messages) lines.push(`  - ${message.replace(/\s+/g, ' ').trim()}`);
  }
  const text = lines.join('\n');
  return text.length > FIX_REQUEST_LIMIT ? `${text.slice(0, FIX_REQUEST_LIMIT - 1)}…` : text;
}
