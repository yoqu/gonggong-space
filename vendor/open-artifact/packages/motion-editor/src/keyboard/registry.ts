/**
 * The page's one list of keyboard shortcuts. Any part of the page adds its own with {@link KeyRegistry.register};
 * the first shortcut whose key matches and whose `when` holds runs, the most recently added first, so a mode (comment
 * mode, a panel) can take a key over while it is on. Pure: no DOM.
 */

/** A key press: the event's `key` and its modifiers. `mod` is Cmd on a Mac, Ctrl elsewhere. */
export interface KeyCombo {
  key: string;
  shift?: boolean;
  mod?: boolean;
  alt?: boolean;
}

/** What the registry reads of a keyboard event. */
export interface KeyPress {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

export interface Shortcut {
  id: string;
  keys: readonly KeyCombo[];
  /** What it does, for help lists. */
  label: string;
  /** Applies only while this holds. */
  when?: () => boolean;
  /** Runs while the key is held (seeking does; toggles do not). */
  repeats?: boolean;
  /** Applies even with the focus in a field, a dialog or a panel (Mod+\). */
  everywhere?: boolean;
  run(press: KeyPress): void;
}

export interface KeyRegistry {
  register(shortcut: Shortcut): () => void;
  /** The shortcut a press runs, or `null`. `inField`: the focus is where plain keys belong to the control. */
  match(press: KeyPress, inField: boolean): Shortcut | null;
  list(): readonly Shortcut[];
}

/** Letters match in either case (Shift is told apart by `shift`); Space is `' '`. */
export function normalizeKey(key: string): string {
  if (key === 'Spacebar') return ' ';
  return key.length === 1 ? key.toLowerCase() : key;
}

export function comboMatches(combo: KeyCombo, press: KeyPress): boolean {
  const mod = press.metaKey || press.ctrlKey;
  return (
    normalizeKey(combo.key) === normalizeKey(press.key) &&
    (combo.shift ?? false) === press.shiftKey &&
    (combo.mod ?? false) === mod &&
    (combo.alt ?? false) === press.altKey
  );
}

export function createKeyRegistry(): KeyRegistry {
  let shortcuts: Shortcut[] = [];
  return {
    register(shortcut) {
      shortcuts = [...shortcuts.filter((known) => known.id !== shortcut.id), shortcut];
      return () => {
        shortcuts = shortcuts.filter((known) => known !== shortcut);
      };
    },
    match(press, inField) {
      for (let index = shortcuts.length - 1; index >= 0; index -= 1) {
        const shortcut = shortcuts[index]!;
        if (inField && shortcut.everywhere !== true) continue;
        if (press.repeat && shortcut.repeats !== true) continue;
        if (!shortcut.keys.some((combo) => comboMatches(combo, press))) continue;
        if (shortcut.when !== undefined && !shortcut.when()) continue;
        return shortcut;
      }
      return null;
    },
    list: () => shortcuts,
  };
}

/** The page's registry. */
export const shortcuts = createKeyRegistry();
