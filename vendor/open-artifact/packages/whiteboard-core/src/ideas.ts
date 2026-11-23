/**
 * Ideas: offers the agent makes on the board ("I could do A, B or C"), each
 * option carrying a preview version (element edits) the person can look at
 * and apply.
 *
 * - Parsing and cleaning of offers, options and their versions.
 * - The idea store: the one idea shown, fed by a whole offer (a saved idea
 *   or a chat answer) or streamed by the agent (`sink`).
 * - The saved idea: an offer the agent stored for one person at
 *   `data/users/<uid>/idea` while their board was closed; the reader shows it
 *   once and deletes it, and the watcher binds the reader to the store.
 */

import { LIVE_RECONNECT_BACKOFF_MS } from './sync/engine.ts';
import { SYSTEM_TIMERS, isAccessError, syncErrorCode, type SyncTimers, type SyncTransport, type TimerHandle } from './sync/transport.ts';
import { documentSha256 } from './sync/doc-hash.ts';
import { tryNormalizeElement } from './normalize.ts';
import type { BoardElement, ElementId } from './schema.ts';

/* -------------------------------------------------------------------------- */
/* Limits and text cleaning                                                   */
/* -------------------------------------------------------------------------- */

/** Limits of a version option (a preview the agent proposes). */
export const VERSION_OPTION_LIMITS = {
  /** Options per offer. */
  versions: 4,
  /** Edits per option. */
  edits: 60,
  /** Bytes of one option's edits as JSON. */
  bytes: 24_576,
  /** Characters of an option's reason. */
  why: 2000,
  /** Nesting depth of edit values. */
  depth: 3,
} as const;

/** Limits of an idea offer. */
export const IDEA_OFFER_LIMITS = {
  says: 2000,
  name: 120,
  label: 60,
  why: VERSION_OPTION_LIMITS.why,
  options: VERSION_OPTION_LIMITS.versions,
  about: 40,
  /** Web embeds one option may create. */
  embeds: 4,
} as const;

/** Bytes of the note sent back with a "make it" request. */
export const IDEA_NOTE_MAX_BYTES = 200;

/** Marks a note that was cut to fit. */
export const NOTE_CUT_MARK = '… [note cut here]';

/** What a scrubbed address reads as. */
export const ADDRESS_REMOVED = '(address removed)';

/** Characters dropped from answers: modifier letters, combining overlays, enclosing marks and invisible characters. */
const STRIPPED_MARK_CHAR_PATTERN = /^[ʰ-˿Ꞌꞌ̴-̸⃐-⃿\p{Me}\p{Default_Ignorable_Code_Point}]$/u;

/** Collapses whitespace, trims and keeps at most `limit` characters. */
export function collapseAndCut(text: unknown, limit: number): string {
  return typeof text === 'string' ? [...text.replace(/\s+/g, ' ').trim()].slice(0, limit).join('') : '';
}

/** {@link collapseAndCut}, ending a cut text at a word with an ellipsis. */
export function clipWithEllipsis(text: unknown, limit: number): string {
  const chars = [...collapseAndCut(text, limit + 1)];
  if (chars.length <= limit) return chars.join('');
  const head = chars.slice(0, limit - 1).join('');
  const cut = chars[limit - 1] === ' ' ? head.length : head.lastIndexOf(' ');
  return `${(cut >= 0 && cut > head.length - 24 ? head.slice(0, cut) : head).replace(/[\s.,;:([…“‘–—-]+$/, '')}…`;
}

/** Drops combining marks with nothing to combine with, and stacks of more than two. */
export function trimStrayMarks(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}\p{M}])\p{M}+/gu, '$1').replace(/(\p{M}{2})\p{M}+/gu, '$1');
}

/** Cleans text the agent wrote for people: no invisible or overlay characters, collapsed, cut to `limit`. */
export function cleanAnswerText(text: unknown, limit: number, cut: (text: string, limit: number) => string = collapseAndCut): string {
  return cut(typeof text === 'string' ? trimStrayMarks([...text].filter((char) => !STRIPPED_MARK_CHAR_PATTERN.test(char)).join('')) : '', limit);
}

const URL_LIKE_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bmailto:/i;
const DOMAIN_LIKE_PATTERN = /\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|net|org|io|dev|app|ai|co|me|ly|gg|xyz|info|biz|edu|gov|link|site|online|page|so|sh|to|tv|cc|us|uk|de|cn|jp|ru|fr)\b/iu;

/** True when the text holds something a reader could follow as a link (a simple check). */
export function containsLinkLike(text: string): boolean {
  const normalized = text.replace(/[。．｡]/g, '.').replace(/\p{Default_Ignorable_Code_Point}/gu, '');
  return URL_LIKE_PATTERN.test(normalized) || DOMAIN_LIKE_PATTERN.test(normalized);
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function takeUtf8Prefix(text: string, maxBytes: number): string {
  let left = maxBytes;
  let kept = '';
  for (const char of text) {
    if ((left -= utf8Length(char)) < 0) break;
    kept += char;
  }
  return kept;
}

/** Cuts a note to `maxBytes` of UTF-8, preferring a sentence end, and marks the cut. */
export function cutNoteToBytes(text: string, maxBytes: number): string {
  if (text === '' || utf8Length(text) <= maxBytes) return text;
  const cut = takeUtf8Prefix(text, maxBytes - utf8Length(` ${NOTE_CUT_MARK}`));
  const sentenceEnd = Math.max(...['. ', '! ', '? '].map((mark) => cut.lastIndexOf(mark)));
  return `${sentenceEnd > cut.length / 2 ? `${cut.slice(0, sentenceEnd + 1)} ` : cut.trimEnd()}${NOTE_CUT_MARK}`;
}

/**
 * Sanitizes a note the agent wrote for the person: no angle brackets, link
 * addresses replaced with {@link ADDRESS_REMOVED}, whitespace collapsed, cut
 * to `maxBytes`. Returns `''` when the result still holds a link.
 */
export function sanitizeAgentNote(note: string, maxBytes = 4096): string {
  const once = (text: string): string =>
    cutNoteToBytes(
      text
        .replace(/[<>]/g, '')
        .split(/\s+/)
        .map((word) => (containsLinkLike(word) ? ADDRESS_REMOVED : word))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
      maxBytes,
    );
  let [current, previous] = [once(note), note];
  for (let pass = 0; pass < 8 && current !== previous; pass++) [current, previous] = [once(current), current];
  return current !== previous || containsLinkLike(current) ? '' : current;
}

/* -------------------------------------------------------------------------- */
/* Offers and versions                                                        */
/* -------------------------------------------------------------------------- */

/** One edit of a version: an element id and the fields to set (or `remove`). */
export interface IdeaVersionEdit {
  id: ElementId;
  [field: string]: unknown;
}

/** A preview version: what the option would change, and why. */
export interface IdeaVersion {
  why?: string;
  edits: IdeaVersionEdit[];
}

/** A request the person can send back to the agent to make an option. */
export interface IdeaMakeRequest {
  /** The agent's note about the option (sanitized). */
  note: string;
  /** Fixed instructions for the agent. */
  request: string;
}

/** One option of an idea. */
export interface IdeaOption {
  label: string;
  /** Absent while the version is still streaming. */
  version?: IdeaVersion;
  /** Added after the idea was first shown. */
  added?: true;
  /** Making the option needs another agent turn. */
  later?: IdeaMakeRequest;
}

/** The parsed core of an offer. */
export interface ParsedIdea {
  says: string;
  /** Element ids the idea is about. */
  about: string[];
  options: IdeaOption[];
}

/** The idea shown. */
export interface Idea extends ParsedIdea {
  /** Increases with every idea shown. */
  serial: number;
  /** The agent finished streaming it. */
  ended: boolean;
  /** Where it came from (`chat`: a whole offer). */
  from?: 'chat';
  /** Elements the offer brought along (for previews of elements not on the board). */
  read?: BoardElement[];
  /** The agent's pending questions, kept while it works. */
  answers?: unknown;
}

/** A whole offer, as the agent saves or sends it (untrusted). */
export interface IdeaOfferInput {
  says?: unknown;
  about?: unknown;
  options?: unknown;
  read?: unknown;
}

/** A raw option of a streamed offer. */
export interface IdeaVersionInput {
  why?: unknown;
  edits?: unknown;
  /** A note: making this option needs another turn. */
  later?: unknown;
}

/** Fields a version edit may set on an existing element. */
export const VERSION_EDIT_FIELDS = [
  'x', 'y', 'w', 'h', 'tilt', 'text', 'label', 'words', 'author', 'size', 'ink', 'textAlign', 'wrap', 'color', 'stroke', 'hollow', 'solid',
  'kind', 'lay', 'dash', 'head', 'heads', 'from', 'to', 'fromSide', 'toSide', 'jog', 'bends', 'width',
] as const;

/** Element types a version may create. */
export const VERSION_NEW_TYPES = ['note', 'shape', 'container', 'text', 'arrow', 'sticker', 'image', 'table', 'stroke'] as const;

/** Fields a version may set on an element it creates. */
export const VERSION_NEW_ELEMENT_FIELDS = [
  ...VERSION_EDIT_FIELDS, 'type', 'by', 'points', 'src', 'style', 'crop', 'cols', 'rows', 'fills', 'heat', 'placeholder', 'glyph', 'art', 'title',
] as const;

/** Fields a version may set on a web embed it creates. */
export const VERSION_NEW_EMBED_FIELDS = [...VERSION_NEW_ELEMENT_FIELDS, 'html', 'state'] as const;

const VERSION_EDIT_ID_PATTERN = /^(?!\.{1,40}$)[A-Za-z0-9_.~:@+-]{1,40}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSeenStamp(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}$/.test(value);
}

function isShallowJsonValue(value: unknown, depth: number): boolean {
  if (typeof value === 'object' && value !== null) return depth > 0 && Object.values(value).every((item) => isShallowJsonValue(item, depth - 1));
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function hasOnlyAllowedJsonKeys(value: Record<string, unknown>, keys: readonly string[], depth: number = VERSION_OPTION_LIMITS.depth): boolean {
  return Object.keys(value).every((key) => keys.includes(key) && isShallowJsonValue(value[key], depth));
}

/** Options of {@link parseVersionOptions}. */
export interface VersionParseOptions {
  /** A version may create web embeds. */
  allowEmbeds?: boolean;
  /** The `author` a version may give notes (the agent's display name); none allowed when absent. */
  agentAuthor?: string;
}

/**
 * One edit of a version, or `undefined` when invalid: `{id, remove: true,
 * seen?, along?}` removes; `{id, type, …}` creates; `{id, …fields, was?}`
 * changes fields (with `was` holding the values it expects).
 */
export function parseVersionEdit(edit: unknown, options: VersionParseOptions = {}): IdeaVersionEdit | undefined {
  if (!isPlainObject(edit)) return undefined;
  const { id, was, ...fields } = edit;
  if (typeof id !== 'string' || !VERSION_EDIT_ID_PATTERN.test(id)) return undefined;
  if (fields.remove === true) {
    const { seen, along = {} } = fields;
    return was === undefined &&
      hasOnlyAllowedJsonKeys(fields, ['remove', 'seen', 'along']) &&
      (seen === undefined || isSeenStamp(seen)) &&
      isPlainObject(along) &&
      Object.entries(along).every(([alongId, stamp]) => VERSION_EDIT_ID_PATTERN.test(alongId) && isSeenStamp(stamp))
      ? { id, ...fields }
      : undefined;
  }
  const creates = 'type' in fields;
  const allowed: readonly string[] = !creates
    ? VERSION_EDIT_FIELDS
    : (VERSION_NEW_TYPES as readonly unknown[]).includes(fields.type)
      ? VERSION_NEW_ELEMENT_FIELDS
      : options.allowEmbeds === true && fields.type === 'html'
        ? VERSION_NEW_EMBED_FIELDS
        : [];
  if (Object.keys(fields).length === 0 || !hasOnlyAllowedJsonKeys(fields, allowed) || ('author' in fields && (options.agentAuthor === undefined || fields.author !== options.agentAuthor))) {
    return undefined;
  }
  if (was === undefined) return { id, ...fields };
  return !creates && isPlainObject(was) && hasOnlyAllowedJsonKeys(was, Object.keys(fields), VERSION_OPTION_LIMITS.depth - 1) && Object.keys(fields).every((key) => key in was)
    ? { id, ...fields, was }
    : undefined;
}

/**
 * The versions of up to `limit` options. An option whose edits are invalid,
 * repeat an id or are too large gets no edits. `undefined` when `options`
 * is not a list.
 */
export function parseVersionOptions(options: unknown, limit: number, parse: VersionParseOptions = {}): IdeaVersion[] | undefined {
  if (!Array.isArray(options)) return undefined;
  return options.slice(0, Math.min(limit, VERSION_OPTION_LIMITS.versions)).map((option: unknown): IdeaVersion => {
    const raw = isPlainObject(option) ? option : {};
    const rawEdits: unknown[] = Array.isArray(raw.edits) && raw.edits.length <= VERSION_OPTION_LIMITS.edits ? raw.edits : [];
    const edits = rawEdits.flatMap((edit) => parseVersionEdit(edit, parse) ?? []);
    const valid =
      edits.length === rawEdits.length &&
      new Set(edits.map((edit) => edit.id)).size === edits.length &&
      utf8Length(JSON.stringify(edits)) <= VERSION_OPTION_LIMITS.bytes;
    const why = clipWithEllipsis(raw.why, VERSION_OPTION_LIMITS.why);
    return { ...(why !== '' ? { why } : {}), edits: valid ? edits : [] };
  });
}

/** The versions of an offer's options: cleaned reasons, and no edits for an option with too many embeds. */
export function parseIdeaOfferVersions(raw: unknown, count: number, parse: VersionParseOptions = {}): IdeaVersion[] {
  return (parseVersionOptions(raw, count, { allowEmbeds: true, ...parse }) ?? []).map((version) => {
    const why = cleanAnswerText(version.why, IDEA_OFFER_LIMITS.why);
    return {
      ...(why !== '' ? { why } : {}),
      edits: version.edits.filter((edit) => edit.type === 'html').length > IDEA_OFFER_LIMITS.embeds ? [] : version.edits,
    };
  });
}

/** The core of an offer, or `undefined` when it says nothing or its labels are empty, repeated or too many. */
export function parseIdeaOffer(raw: { says?: unknown; about?: unknown; labels?: unknown }): ParsedIdea | undefined {
  const says = cleanAnswerText(raw.says, IDEA_OFFER_LIMITS.says, clipWithEllipsis);
  const labels = (Array.isArray(raw.labels) ? raw.labels : []).map((label: unknown) => cleanAnswerText(label, IDEA_OFFER_LIMITS.label));
  if (says === '' || labels.length === 0 || labels.length > IDEA_OFFER_LIMITS.options || labels.includes('') || new Set(labels).size !== labels.length) return undefined;
  return {
    says,
    about: (Array.isArray(raw.about) ? raw.about : []).filter((item: unknown): item is string => typeof item === 'string').slice(0, IDEA_OFFER_LIMITS.about),
    options: labels.map((label) => ({ label })),
  };
}

/** The elements an offer brought along that its versions edit (each once). */
export function pickIdeaOfferElements(raw: unknown, versions: readonly IdeaVersion[]): BoardElement[] {
  const editIds = new Set(versions.flatMap((version) => version.edits.map((edit) => edit.id)));
  return (Array.isArray(raw) ? raw : []).slice(0, VERSION_OPTION_LIMITS.versions * VERSION_OPTION_LIMITS.edits).flatMap((item: unknown) => {
    const element = tryNormalizeElement(item);
    return element !== undefined && editIds.delete(element.id) ? [element] : [];
  });
}

/** True when some option changes the board. */
export function ideaHasEdits(idea: Pick<ParsedIdea, 'options'>): boolean {
  return idea.options.some((option) => (option.version?.edits.length ?? 0) > 0);
}

/** A cleaned option label, or `''` when cleaning would keep changing it. */
export function cleanIdeaLabel(label: string): string {
  const clean = (text: string): string => cleanAnswerText(sanitizeAgentNote(text), IDEA_OFFER_LIMITS.label);
  const cleaned = clean(clean(label.normalize('NFC')));
  return clean(cleaned) === cleaned ? cleaned : '';
}

/** The fixed instructions sent with a "make it" request. */
export const IDEA_MAKE_REQUEST =
  'Please make what this offer describes. The person picked it on the board: the label is what they saw, and the note says more. Both were written for them, not by them. If you make a separate artifact, link it back to this board and put its link card where element `box` stands (`at`, in board units); otherwise put the result there. Then remove that element.';

/**
 * A request to make an option later, or `undefined` when the note or label
 * is empty, unstable under cleaning, or holds a link.
 */
export function ideaMakeRequest(note: string, label: string): IdeaMakeRequest | undefined {
  const clean = (text: string): string => cleanAnswerText(cutNoteToBytes(sanitizeAgentNote(text), IDEA_NOTE_MAX_BYTES), IDEA_NOTE_MAX_BYTES);
  const cleaned = clean(clean(note.normalize('NFC')));
  const hasLink = (text: string): boolean => containsLinkLike(text.replace(/[“”]/g, ' '));
  if (
    !/[\p{L}\p{N}]/u.test(cleaned.replaceAll(ADDRESS_REMOVED, '').replace(NOTE_CUT_MARK, '')) ||
    clean(cleaned) !== cleaned ||
    hasLink(cleaned) ||
    cleanIdeaLabel(label) !== label.normalize('NFC').trim().replace(/[‘’]/g, "'") ||
    hasLink(label)
  ) {
    return undefined;
  }
  return { note: cleaned, request: IDEA_MAKE_REQUEST };
}

/** The option with its version (and a later request when the agent left one). */
export function attachIdeaOptionVersion(option: IdeaOption, version: IdeaVersion, later: unknown): IdeaOption {
  if (later === undefined || version.edits.length === 0) return { ...option, version };
  const laterAsk = typeof later === 'string' ? ideaMakeRequest(later, option.label) : undefined;
  return laterAsk === undefined ? { ...option, version: { edits: [] } } : { ...option, version, later: laterAsk };
}

/* -------------------------------------------------------------------------- */
/* The idea store                                                             */
/* -------------------------------------------------------------------------- */

/** A streamed idea's start. */
export interface IdeaBegin {
  says?: unknown;
  about?: unknown;
  labels?: unknown;
  answers?: unknown;
}

/** A row added to the shown idea. */
export interface IdeaRow {
  label?: unknown;
  /** The labels the agent saw; the row is refused when they changed. */
  beside?: readonly string[];
}

/** How a streamed idea ended. */
export type IdeaEnd = 'done' | 'stopped';

/** Where a streaming agent writes its idea. */
export interface IdeaSink {
  /** Starts an idea (shown once a version has edits). */
  begin(begin: IdeaBegin): boolean;
  /** Adds an option to the shown idea. */
  add(row: IdeaRow): boolean;
  /** Versions streamed so far, for the options being streamed. */
  options(versions: readonly IdeaVersionInput[]): void;
  /** The agent did some work (questions are answered). */
  worked(): void;
  /** Ends the stream; `true` when what was streamed has edits to show. */
  end(how?: IdeaEnd): boolean;
}

/** The one idea shown. */
export interface IdeaStore {
  now(): Idea | undefined;
  subscribe(listener: () => void): () => void;
  /** Hides the idea (picked, dismissed or applied). */
  settle(): void;
  /** Shows a whole offer; returns its serial, or `undefined` when it has nothing to show. */
  offer(offer: IdeaOfferInput): number | undefined;
  sink: IdeaSink;
}

/** Options of {@link createIdeaStore}. */
export interface IdeaStoreOptions {
  /** How versions are parsed (the agent's author name). */
  versions?: VersionParseOptions;
}

/** Creates the idea store. */
export function createIdeaStore(storeOptions: IdeaStoreOptions = {}): IdeaStore {
  const parseVersions = (raw: unknown, count: number): IdeaVersion[] => parseIdeaOfferVersions(raw, count, storeOptions.versions);
  let current: Idea | undefined;
  let pending: Idea | undefined;
  let lastSerial = 0;
  let settledSerial = 0;
  let stream = { serial: 0, from: 0 };
  const listeners = new Set<() => void>();
  const publish = (idea: Idea | undefined): void => {
    current = idea;
    for (const listener of [...listeners]) listener();
  };
  return {
    now: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    settle() {
      if (current === undefined) return;
      if (current.serial === stream.serial) settledSerial = stream.serial;
      publish(undefined);
    },
    offer(offer) {
      const options = (Array.isArray(offer.options) ? offer.options : []).map((option: unknown): Record<string, unknown> => (isPlainObject(option) ? option : {}));
      const idea = parseIdeaOffer({ says: offer.says, about: offer.about, labels: options.map((option) => option.label) });
      if (idea === undefined) return undefined;
      const versions = parseVersions(
        options.map((option) => ({ why: option.why, edits: option.edits })),
        options.length,
      );
      const shown: Idea = {
        ...idea,
        serial: ++lastSerial,
        ended: true,
        from: 'chat',
        read: pickIdeaOfferElements(offer.read, versions),
        options: idea.options.map((option, index) => ({ ...option, version: versions[index] ?? { edits: [] } })),
      };
      if (!ideaHasEdits(shown)) return undefined;
      publish(shown);
      return shown.serial;
    },
    sink: {
      begin({ answers, ...rest }) {
        const idea = parseIdeaOffer(rest);
        if (idea === undefined) return false;
        pending = { ...idea, serial: ++lastSerial, ended: false, ...(answers !== undefined && answers !== null && answers !== false ? { answers } : {}) };
        stream = { serial: lastSerial, from: 0 };
        return true;
      },
      add(row) {
        const label = cleanAnswerText(row.label, IDEA_OFFER_LIMITS.label);
        if (
          current === undefined ||
          pending !== undefined ||
          !current.ended ||
          current.options.length >= IDEA_OFFER_LIMITS.options ||
          label === '' ||
          current.options.some((option) => option.label === label) ||
          (row.beside !== undefined && row.beside.join('\n') !== current.options.map((option) => option.label).join('\n'))
        ) {
          return false;
        }
        stream = { serial: current.serial, from: current.options.length };
        publish({ ...current, options: [...current.options, { label, added: true }], ended: false });
        return true;
      },
      options(versions) {
        const target = pending ?? (current?.serial === stream.serial && !current.ended ? current : undefined);
        if (target === undefined) return;
        const fresh = target.options.slice(stream.from);
        const ready = fresh.filter((option) => option.version !== undefined).length;
        const parsed = parseVersions(versions, fresh.length);
        if (parsed.length <= ready) return;
        const next: Idea = {
          ...target,
          options: target.options.map((option, index) => {
            const version = parsed[index - stream.from];
            return option.version === undefined && version !== undefined ? attachIdeaOptionVersion(option, version, versions[index - stream.from]?.later) : option;
          }),
        };
        if (target !== pending) return publish(next);
        if (!ideaHasEdits(next)) {
          pending = next;
          return;
        }
        pending = undefined;
        publish(next);
      },
      worked() {
        const withoutAnswers = ({ answers: _answers, ...rest }: Idea): Idea => rest;
        if (pending?.answers !== undefined) pending = withoutAnswers(pending);
        if (current?.answers !== undefined) publish(withoutAnswers(current));
      },
      end(how) {
        if (pending !== undefined) {
          pending = undefined;
          return false;
        }
        if (current?.serial !== stream.serial) return settledSerial === stream.serial && stream.serial > 0;
        const hasEdits = ideaHasEdits({ options: current.options.slice(stream.from) });
        if (current.ended) return hasEdits;
        const keep = how !== 'stopped' && (stream.from === 0 || hasEdits);
        publish(
          keep
            ? { ...current, options: current.options.map((option) => ({ ...option, version: option.version ?? { edits: [] } })), ended: true }
            : stream.from === 0
              ? undefined
              : { ...current, options: current.options.slice(0, stream.from), ended: true },
        );
        return keep && hasEdits;
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The saved idea                                                             */
/* -------------------------------------------------------------------------- */

/** Bytes of a saved idea, at most (a larger one is dropped unread). */
export const MAX_SAVED_IDEA_BYTES = 102_400;
/** The saved idea's document name. */
export const SAVED_IDEA_DOC_NAME = 'idea';
/** After a write, how long to wait for the saved idea before reading again. */
export const SAVED_IDEA_QUIET_RETRY_MS = 35_000;
/** Attempts to delete a shown saved idea. */
export const SAVED_IDEA_DELETE_ATTEMPTS = 3;
/** The wait between delete attempts. */
export const SAVED_IDEA_DELETE_RETRY_MS = 5000;
/** A saved idea nobody changed for this long is dropped (when someone sees the board). */
export const SAVED_IDEA_EXPIRE_MS = 1_800_000;
/** After the board is shown again, an old idea stays this long before it is dropped. */
export const SAVED_IDEA_SHOWN_GRACE_MS = 60_000;

/** The path of one person's saved idea. */
export function savedIdeaPath(userId: string): string {
  return `data/users/${userId}/${SAVED_IDEA_DOC_NAME}`;
}

/** The collection holding one person's saved idea. */
export function savedIdeaCollection(userId: string): string {
  return `data/users/${userId}`;
}

/** A saved idea as read: the offer, `'large'` when over the limit, `null` when absent. */
export type SavedIdeaDoc = IdeaOfferInput | 'large' | null;

/** A stand-in for an idea too large to read. */
export const LARGE_IDEA_DOC: IdeaOfferInput = Object.freeze({});

const ideaJsonKeys = new WeakMap<object, string>();
function ideaJsonKey(doc: object): string {
  let key = ideaJsonKeys.get(doc);
  if (key === undefined) {
    key = JSON.stringify(doc);
    ideaJsonKeys.set(doc, key);
  }
  return key;
}

/** True when two saved ideas are the same document. */
export function sameIdeaDoc(left: IdeaOfferInput | null | undefined, right: IdeaOfferInput | null | undefined): boolean {
  return left === right || (left != null && right != null && ideaJsonKey(left) === ideaJsonKey(right));
}

/** The size of a saved idea as JSON. */
export function savedIdeaByteLength(value: unknown): number {
  return utf8Length(JSON.stringify(value));
}

/** What the saved-idea reader needs. */
export interface SavedIdeaReaderDeps {
  ideas: Pick<IdeaStore, 'now' | 'offer' | 'settle' | 'subscribe'>;
  now(): number;
  /** Something else holds the idea slot (an agent turn is running). */
  held(): boolean;
  /** The board is loaded and can show an idea. */
  ready(): boolean;
  /** The page is visible. */
  seen(): boolean;
  /** Deletes the saved idea. */
  drop(): void;
  timers?: Pick<SyncTimers, 'setTimeout' | 'clearTimeout'>;
}

/** Shows a saved idea once, and asks to delete it once it was shown and dismissed (or is old). */
export interface SavedIdeaReader {
  /** The saved idea changed. */
  heard(doc: SavedIdeaDoc): void;
  /** The slot may be free now: show a waiting idea. */
  look(): void;
  /** The board became visible. */
  shown(): void;
  /** The idea was deleted. */
  dropped(doc: SavedIdeaDoc): void;
  dispose(): void;
}

/** Creates the saved-idea reader. */
export function createSavedIdeaReader(deps: SavedIdeaReaderDeps): SavedIdeaReader {
  const timers = deps.timers ?? SYSTEM_TIMERS;
  let lastHeard: IdeaOfferInput | null = null;
  let lastChangeAt = 0;
  let offered: { doc: IdeaOfferInput; serial: number | undefined } | undefined;
  let pending: IdeaOfferInput | null | undefined;
  let dropping: IdeaOfferInput | undefined;
  let offering = false;
  let refreshTimer: TimerHandle | undefined;
  const drop = (doc: IdeaOfferInput): void => {
    dropping = doc;
    deps.drop();
  };
  const offerPending = (): void => {
    const current = deps.ideas.now();
    if (pending === undefined || !deps.ready() || (current !== undefined && (deps.held() || !current.ended))) return;
    const doc = pending;
    const offeredSerial = offered?.serial;
    pending = undefined;
    offering = true;
    const serial = doc === null ? undefined : deps.ideas.offer(doc);
    if (serial === undefined && offeredSerial !== undefined) deps.ideas.settle();
    offering = false;
    offered = doc === null ? undefined : { doc, serial };
    if (doc !== null && serial === undefined) drop(doc);
  };
  const unsubscribe = deps.ideas.subscribe(() => {
    if (offering) return;
    if (offered?.serial !== undefined && deps.ideas.now()?.serial !== offered.serial) {
      offered = { ...offered, serial: undefined };
      if (pending === undefined) return drop(offered.doc);
    }
    offerPending();
  });
  const scheduleRefresh = (): void => {
    if (refreshTimer !== undefined) timers.clearTimeout(refreshTimer);
    refreshTimer = lastHeard === null ? undefined : timers.setTimeout(refresh, Math.max(0, lastChangeAt + SAVED_IDEA_EXPIRE_MS - deps.now()));
  };
  function refresh(): void {
    refreshTimer = undefined;
    if (!deps.seen()) return;
    lastChangeAt = deps.now() - SAVED_IDEA_EXPIRE_MS + SAVED_IDEA_SHOWN_GRACE_MS;
    if (!deps.held() && deps.ready() && lastHeard !== null) drop(lastHeard);
    scheduleRefresh();
  }
  const normalize = (doc: SavedIdeaDoc): IdeaOfferInput | null => (doc === 'large' ? LARGE_IDEA_DOC : doc);
  return {
    heard(raw) {
      const doc = normalize(raw);
      if (!sameIdeaDoc(doc, lastHeard)) lastChangeAt = deps.now();
      lastHeard = doc;
      const next = dropping !== undefined && sameIdeaDoc(doc, dropping) ? null : doc;
      const skip = next === null ? offered === undefined : offered?.serial !== undefined && sameIdeaDoc(next, offered.doc);
      pending = skip ? undefined : next;
      offerPending();
      scheduleRefresh();
    },
    look: offerPending,
    shown() {
      lastChangeAt = deps.now();
      scheduleRefresh();
    },
    dropped(raw) {
      if (dropping !== undefined && sameIdeaDoc(normalize(raw), dropping)) dropping = undefined;
    },
    dispose() {
      if (refreshTimer !== undefined) timers.clearTimeout(refreshTimer);
      refreshTimer = undefined;
      unsubscribe();
      if (offered?.serial !== undefined && deps.ideas.now()?.serial === offered.serial) deps.ideas.settle();
    },
  };
}

/** Options of {@link watchSavedIdea}. */
export interface SavedIdeaWatchOptions extends Omit<SavedIdeaReaderDeps, 'drop' | 'now' | 'timers'> {
  transport: SyncTransport;
  userId: string;
  timers?: SyncTimers;
}

/** A running saved-idea watch. */
export interface SavedIdeaWatch {
  /** The slot may be free now. */
  look(): void;
  /** The board became visible. */
  shown(): void;
  /** Reads the saved idea again (after this person wrote to the agent). */
  reread(): void;
  dispose(): void;
}

/**
 * Binds a saved-idea reader to the store: reads the person's idea document,
 * follows changes to it, and deletes it once shown (retrying a few times
 * while it is still the same idea). A failed read retries with backoff,
 * unless access was refused.
 */
export function watchSavedIdea(options: SavedIdeaWatchOptions): SavedIdeaWatch {
  const timers = options.timers ?? SYSTEM_TIMERS;
  const path = savedIdeaPath(options.userId);
  const maxBackoff = LIVE_RECONNECT_BACKOFF_MS.at(-1) ?? 60_000;
  let disposed = false;
  let lastSeen: SavedIdeaDoc = null;
  /** The hash of the stored document behind `lastSeen` (null: absent). */
  let lastSeenHash: string | null = null;
  let deleteTimer: TimerHandle | undefined;
  let rereadTimer: TimerHandle | undefined;
  let backoffStep = 0;
  let generation = 0;
  const clear = (handle: TimerHandle | undefined): undefined => {
    if (handle !== undefined) timers.clearTimeout(handle);
    return undefined;
  };
  const read = (data: Record<string, unknown> | null): SavedIdeaDoc => (data === null ? null : savedIdeaByteLength(data) > MAX_SAVED_IDEA_BYTES ? 'large' : data);
  const sameSeen = (a: SavedIdeaDoc, b: SavedIdeaDoc): boolean => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
  const remember = (data: Record<string, unknown> | null): void => {
    lastSeen = read(data);
    lastSeenHash = data === null ? null : documentSha256(data);
  };
  // The delete holds only while the idea is still the one shown (`ifMatch`): one
  // the agent wrote meanwhile (a replacement) is never deleted unseen.
  const deleteIdea = (attempts: number, doc: SavedIdeaDoc, hash: string | null): void => {
    options.transport.write([{ op: 'delete', path, ...(hash !== null ? { ifMatch: hash } : {}) }]).then(
      () => {
        if (disposed) return;
        if (sameSeen(lastSeen, doc)) {
          lastSeen = null;
          lastSeenHash = null;
        }
        reader.dropped(doc);
      },
      (error: unknown) => {
        deleteTimer = clear(deleteTimer);
        // Another idea took its place: it arrives as a change (or with the next read); leave it be.
        if (syncErrorCode(error) === 'conflict') {
          if (!disposed && sameSeen(lastSeen, doc)) fetch();
          return;
        }
        if (attempts > 1 && !disposed) {
          deleteTimer = timers.setTimeout(() => {
            deleteTimer = undefined;
            if (!disposed && (lastSeen === null || sameSeen(lastSeen, doc))) deleteIdea(attempts - 1, doc, hash);
          }, SAVED_IDEA_DELETE_RETRY_MS);
        }
      },
    );
  };
  const reader = createSavedIdeaReader({
    ideas: options.ideas,
    now: () => timers.now(),
    held: options.held,
    ready: options.ready,
    seen: options.seen,
    timers,
    drop: () => {
      deleteTimer = clear(deleteTimer);
      deleteIdea(SAVED_IDEA_DELETE_ATTEMPTS, lastSeen, lastSeenHash);
    },
  });
  const fetch = (): void => {
    rereadTimer = clear(rereadTimer);
    const started = ++generation;
    options.transport.get(path).then(
      (data) => {
        if (disposed || started !== generation) return;
        backoffStep = 0;
        remember(data);
        reader.heard(lastSeen);
      },
      (error: unknown) => {
        if (disposed || started !== generation || isAccessError(syncErrorCode(error))) return;
        const delay = LIVE_RECONNECT_BACKOFF_MS[backoffStep++] ?? maxBackoff;
        rereadTimer = timers.setTimeout(fetch, delay);
      },
    );
  };
  const stopListening = options.transport.onChange((event) => {
    if (disposed || !(path in event.changes)) return;
    generation += 1;
    remember(event.changes[path] ?? null);
    reader.heard(lastSeen);
  });
  fetch();
  return {
    look: () => reader.look(),
    shown: () => reader.shown(),
    reread() {
      if (disposed) return;
      fetch();
      // The agent may save its idea a little after the write: look again once more.
      rereadTimer = timers.setTimeout(fetch, SAVED_IDEA_QUIET_RETRY_MS);
    },
    dispose() {
      disposed = true;
      stopListening();
      deleteTimer = clear(deleteTimer);
      rereadTimer = clear(rereadTimer);
      reader.dispose();
    },
  };
}
