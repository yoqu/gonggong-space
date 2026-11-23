/** Platform key labels and the text-field test every editor's shortcuts use. Pure. */

/** True on Apple platforms (⌘ instead of Ctrl in labels and shortcuts). */
export function isApplePlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** The platform's modifier key, as shortcuts are written. */
export const MOD = isApplePlatform() ? '⌘' : 'Ctrl+';
/** The platform's option key. */
export const ALT = MOD === '⌘' ? '⌥' : 'Alt+';
/** The platform's shift key. */
export const SHIFT = MOD === '⌘' ? '⇧' : 'Shift+';

/** The platform's modifier label, read now. */
export function modKey(): string {
  return isApplePlatform() ? '⌘' : 'Ctrl+';
}

/** True when a key or clipboard event goes to a text field (input, textarea, select or editable text). */
export function isTextField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
}

/**
 * The next focus index inside a toolbar for Arrow keys, Home and End: arrows step and wrap,
 * Home and End jump to the first and last items, and other keys return null.
 */
export function getToolbarKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0 || index < 0 || index >= count) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
