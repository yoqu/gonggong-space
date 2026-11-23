import { shortcuts, type KeyRegistry } from './registry.ts';

/** Input types that are controls rather than text fields (so playback and undo shortcuts stay active on them). */
export const NON_TEXT_INPUT_TYPES = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

const NOT_NON_TEXT = [...NON_TEXT_INPUT_TYPES].map((type) => `:not([type="${type}"])`).join('');

/** Controls where typing and native undo belong to the field itself. */
export const TEXT_ENTRY_SELECTOR = `input${NOT_NON_TEXT}, textarea, [contenteditable="true"], [contenteditable=""]`;

/** Where plain keys belong to the control under focus: text fields, selects, dialogs, menus and side panels. */
export const KEYS_STAY_IN = `${TEXT_ENTRY_SELECTOR}, select, [role="dialog"], [role="alertdialog"], [role="menu"], [role="complementary"]`;

/** Minimal element shape for checking text-entry focus without a DOM. */
export interface FocusTargetLike {
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
}

/** True when `node` is a text input, textarea or editable region (not a slider, checkbox, radio, color picker or button). */
export function isTextEntryTarget(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const el = node as FocusTargetLike;
  if (el.isContentEditable === true) return true;
  const editable = el.getAttribute?.('contenteditable');
  if (editable === '' || editable === 'true') return true;
  if (typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = (el.type ?? el.getAttribute?.('type') ?? 'text').toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}

/** While one of these is open anywhere, plain keys are its own. */
const OPEN_OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"]';

export function keysStayIn(target: EventTarget | null, doc: Document): boolean {
  const element = target instanceof Element ? target : null;
  if (element?.closest(KEYS_STAY_IN) != null) return true;
  return doc.querySelector(OPEN_OVERLAY) !== null;
}

/** Space and Enter on a button press the button, not a shortcut. */
const PRESSES = 'button, a[href], [role="button"], [role="checkbox"], [role="switch"], [role="tab"], summary';
const pressesControl = (event: KeyboardEvent): boolean =>
  (event.key === ' ' || event.key === 'Enter') && event.target instanceof Element && event.target.closest(PRESSES) !== null;

/** Runs the registry's shortcuts on key presses in this window; returns a stop function. */
export function installShortcuts(target: Window, registry: KeyRegistry = shortcuts): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || pressesControl(event)) return;
    const shortcut = registry.match(event, keysStayIn(event.target, target.document));
    if (shortcut === null) return;
    event.preventDefault();
    shortcut.run(event);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
