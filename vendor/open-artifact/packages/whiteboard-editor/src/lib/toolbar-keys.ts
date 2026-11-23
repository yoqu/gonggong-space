/**
 * Arrow keys in a bar of controls: ← and → step to the previous or next
 * control that is enabled, Home and End go to the first and last one. ↑ and
 * ↓ stay with the control (they open a menu button's menu).
 */

/** The key press a bar looks at. */
export interface BarKeyPress {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}

/**
 * Which control a key press moves to: its index in `enabled` (one entry per
 * control, `false` for a disabled one), or `undefined` when the key does
 * not move (another key, a modifier, input-method composition, or no other
 * enabled control that way). `current` is the focused control's index.
 */
export function barKeyTarget(event: BarKeyPress, current: number, enabled: readonly boolean[]): number | undefined {
  if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return undefined;
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (event.key === 'Home' || event.key === 'End') {
    const order = enabled.map((_, index) => index);
    const found = (event.key === 'Home' ? order : order.reverse()).find((index) => enabled[index]);
    return found === current ? undefined : found;
  }
  if (step === 0) return undefined;
  for (let index = current + step; index >= 0 && index < enabled.length; index += step) {
    if (enabled[index]) return index;
  }
  return undefined;
}
