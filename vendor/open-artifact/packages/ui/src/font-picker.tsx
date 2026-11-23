/**
 * {@link FontPicker}: one searchable list of the design system's fonts, the
 * fonts that render on this computer, and the Google Fonts catalog (loaded
 * on first open, grouped by category). Each visible Google row loads just
 * the glyphs of its own name from fonts.googleapis.com, so it shows in its
 * face without downloading whole families.
 */
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { cn } from './cn.ts';
import {
  FONT_CATEGORIES,
  detectInstalledFonts,
  ensureFontPreview,
  fontFamilyCss,
  fontMatchScore,
  googleFontStylesheetUrl,
  loadGoogleFontCatalog,
  normalizeFontName,
  searchFonts,
  type FontCategory,
  type GoogleFont,
} from './fonts.ts';
import { preventRepeatedActivation } from './keys.ts';
import { POPUP_CLASS } from './menu.tsx';

/** A font the design system provides. */
export interface DesignSystemFont {
  family: string;
  /** Token or role name shown beside it (`heading`, `--font-body`). */
  label?: string;
  /** Stylesheet that loads it (an `@font-face` file or a Google Fonts URL). */
  stylesheet?: string | null;
  category?: FontCategory;
}

/** Where a picked font comes from. */
export type FontSource = 'design-system' | 'installed' | 'google';

/** What {@link FontPicker} reports. */
export interface FontPick {
  family: string;
  source: FontSource;
  /**
   * CSS to link so the family renders: the Google Fonts URL for the chosen
   * weights, the design system's stylesheet, or null (installed fonts).
   */
  stylesheet: string | null;
  /** A `font-family` value with a generic fallback. */
  css: string;
  category?: FontCategory;
  /** The catalog entry of a Google font (weights, italics, axes). */
  google?: GoogleFont;
}

/** Props of {@link FontPicker}. */
export interface FontPickerProps {
  /** The current family, or null. */
  value: string | null;
  onChange: (pick: FontPick) => void;
  'aria-label': string;
  designSystemFonts?: readonly DesignSystemFont[];
  /** Families that render here. Default: common system fonts that are installed, plus fonts the page loaded. */
  installedFonts?: readonly string[];
  /** Offer the Google Fonts catalog (default true). */
  googleFonts?: boolean;
  /** Weights the returned Google stylesheet asks for (default 400 and 700, those the family has). */
  weights?: readonly number[];
  /** Also request italics. */
  italic?: boolean;
  /** Request the whole weight range of variable families. */
  variable?: boolean;
  /** Trigger text while no font is set. */
  placeholder?: string;
  /** Several selected things differ. */
  mixed?: boolean;
  disabled?: boolean;
  /** Your own trigger element instead of the field. */
  trigger?: ReactElement<Record<string, unknown>>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** One row of the list. */
type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'font'; key: string; family: string; source: FontSource; detail?: string; category?: FontCategory; google?: GoogleFont; stylesheet?: string | null };

const ROW_HEIGHT = 30;
const LIST_HEIGHT = 320;
const OVERSCAN = 6;
/** Wait for scrolling to settle before loading previews. */
const PREVIEW_DELAY_MS = 120;

const loadedStylesheets = new Set<string>();
function ensureStylesheet(href: string) {
  if (typeof document === 'undefined' || loadedStylesheets.has(href)) return;
  loadedStylesheets.add(href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/** Builds the rows for a query and category. */
function buildRows(
  query: string,
  category: FontCategory | null,
  designSystem: readonly DesignSystemFont[],
  installed: readonly string[],
  catalog: readonly GoogleFont[] | null,
): Row[] {
  const q = normalizeFontName(query);
  const rows: Row[] = [];
  const seen = new Set<string>();
  const rank = <T,>(items: readonly T[], name: (item: T) => string[]) =>
    items
      .map((item) => ({ item, score: Math.max(...name(item).map((n) => fontMatchScore(n, q))) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);

  const ds = rank(
    designSystem.filter((font) => !category || font.category === category),
    (font) => [font.family, font.label ?? ''],
  );
  if (ds.length) {
    rows.push({ kind: 'header', key: 'h:ds', label: 'Design system' });
    for (const font of ds) {
      seen.add(font.family.toLowerCase());
      rows.push({ kind: 'font', key: `ds:${font.label ?? ''}:${font.family}`, family: font.family, source: 'design-system', detail: font.label, category: font.category, stylesheet: font.stylesheet });
    }
  }
  if (!category) {
    const local = rank(installed, (family) => [family]).filter((family) => !seen.has(family.toLowerCase()));
    if (local.length) {
      rows.push({ kind: 'header', key: 'h:installed', label: 'On this computer' });
      for (const family of local) {
        seen.add(family.toLowerCase());
        rows.push({ kind: 'font', key: `local:${family}`, family, source: 'installed' });
      }
    }
  }
  if (catalog) {
    const fontRow = (font: GoogleFont): Row => ({ kind: 'font', key: `g:${font.family}`, family: font.family, source: 'google', category: font.category, google: font });
    if (q) {
      const found = searchFonts(catalog, q, { category }).filter((font) => !seen.has(font.family.toLowerCase()));
      if (found.length) {
        rows.push({ kind: 'header', key: 'h:google', label: 'Google Fonts' });
        rows.push(...found.map(fontRow));
      }
    } else {
      for (const group of FONT_CATEGORIES) {
        if (category && group.value !== category) continue;
        const fonts = catalog.filter((font) => font.category === group.value && !seen.has(font.family.toLowerCase()));
        if (!fonts.length) continue;
        rows.push({ kind: 'header', key: `h:${group.value}`, label: `Google Fonts · ${group.label}` });
        rows.push(...fonts.map(fontRow));
      }
    }
  }
  return rows;
}

/**
 * A font family picker. Type to search the design system's fonts, the
 * installed ones and Google Fonts; arrow keys move, Enter picks, Escape
 * closes. Category chips narrow the list.
 */
export function FontPicker({
  value,
  onChange,
  designSystemFonts = [],
  installedFonts,
  googleFonts = true,
  weights,
  italic,
  variable,
  placeholder = 'Font',
  mixed = false,
  disabled,
  trigger,
  open: openProp,
  onOpenChange,
  className,
  ...aria
}: FontPickerProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const label = aria['aria-label'];
  const text = mixed ? 'Mixed' : (value ?? placeholder);
  const element = trigger ?? (
    <button
      type="button"
      aria-label={`${label}: ${text}`}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-1 rounded-control border border-line bg-surface-2 pl-2 pr-1.5 text-left text-[13px] text-fg outline-none',
        'focus-visible:border-accent data-[popup-open]:border-accent disabled:opacity-45',
        className,
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', (mixed || !value) && 'text-fg-subtle')} style={value && !mixed ? { fontFamily: fontFamilyCss(value) } : undefined}>
        {text}
      </span>
      <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
    </button>
  );
  return (
    <BasePopover.Root open={open} onOpenChange={(next) => setOpen(next)}>
      <BasePopover.Trigger render={element} disabled={disabled} onKeyDown={preventRepeatedActivation} />
      <BasePopover.Portal>
        <BasePopover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="z-[1000]">
          <BasePopover.Popup aria-label={`${label} fonts`} className={cn(POPUP_CLASS, 'w-72 p-0')}>
            {open ? (
              <FontList
                value={mixed ? null : value}
                designSystemFonts={designSystemFonts}
                installedFonts={installedFonts}
                googleFonts={googleFonts}
                onPick={(row) => {
                  const google = row.google;
                  const stylesheet =
                    row.source === 'google' ? googleFontStylesheetUrl(row.family, { weights, italic, variable }, google) : row.source === 'design-system' ? (row.stylesheet ?? null) : null;
                  onChange({ family: row.family, source: row.source, stylesheet, css: fontFamilyCss(row.family, row.category), category: row.category, google });
                  setOpen(false);
                }}
              />
            ) : null}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/** The popover body: search, category chips, the virtualized list. */
function FontList({
  value,
  designSystemFonts,
  installedFonts,
  googleFonts,
  onPick,
}: {
  value: string | null;
  designSystemFonts: readonly DesignSystemFont[];
  installedFonts?: readonly string[];
  googleFonts: boolean;
  onPick: (row: Extract<Row, { kind: 'font' }>) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | null>(null);
  const [catalog, setCatalog] = useState<GoogleFont[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const installed = useMemo(() => installedFonts ?? detectInstalledFonts(), [installedFonts]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (!googleFonts) return;
    let live = true;
    loadGoogleFontCatalog()
      .then((loaded) => live && setCatalog(loaded))
      .catch(() => live && setCatalogError(true));
    return () => {
      live = false;
    };
  }, [googleFonts]);

  useEffect(() => inputRef.current?.focus(), []);

  const rows = useMemo(() => buildRows(query, category, designSystemFonts, installed, catalog), [query, category, designSystemFonts, installed, catalog]);
  const valueKey = value ? normalizeFontName(value) : null;
  const selectedIndex = valueKey ? rows.findIndex((row) => row.kind === 'font' && normalizeFontName(row.family) === valueKey) : -1;
  const firstFont = rows.findIndex((row) => row.kind === 'font');
  const [active, setActive] = useState<number>(-1);

  // Start on the current font (once it is in the list), else the first match.
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && selectedIndex >= 0) {
      started.current = true;
      setActive(selectedIndex);
      scrollToRow(selectedIndex, 'center');
      return;
    }
    if (started.current || query) setActive(firstFont);
    else setActive(selectedIndex >= 0 ? selectedIndex : firstFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const scrollToRow = (index: number, mode: 'nearest' | 'center' = 'nearest') => {
    const list = listRef.current;
    if (!list || index < 0) return;
    const top = index * ROW_HEIGHT;
    if (mode === 'center') list.scrollTop = Math.max(0, top - LIST_HEIGHT / 2 + ROW_HEIGHT / 2);
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + LIST_HEIGHT) list.scrollTop = top + ROW_HEIGHT - LIST_HEIGHT;
    setScrollTop(list.scrollTop);
  };

  const moveActive = (by: number) => {
    if (!rows.length) return;
    let next = active;
    const direction = Math.sign(by);
    let remaining = Math.abs(by);
    while (remaining > 0) {
      let probe = next + direction;
      while (probe >= 0 && probe < rows.length && rows[probe]!.kind !== 'font') probe += direction;
      if (probe < 0 || probe >= rows.length) break;
      next = probe;
      remaining--;
    }
    if (next !== active && next >= 0) {
      setActive(next);
      scrollToRow(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
    const by = moves[event.key];
    if (by !== undefined) {
      event.preventDefault();
      moveActive(by);
      return;
    }
    if (event.key === 'Enter') {
      const row = rows[active];
      if (row?.kind === 'font') {
        event.preventDefault();
        onPick(row);
      }
    }
  };

  // Rows on screen (plus a margin).
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  // Load previews of the Google rows actually on screen once scrolling settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      const top = Math.floor(scrollTop / ROW_HEIGHT);
      const bottom = Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT);
      for (const row of rows.slice(top, bottom)) {
        if (row.kind !== 'font') continue;
        if (row.source === 'google') ensureFontPreview(row.family, row.google);
        else if (row.source === 'design-system' && row.stylesheet) ensureStylesheet(row.stylesheet);
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [rows, scrollTop]);

  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-opt-${index}`;
  const activeRow = rows[active];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-2.5">
        <Search className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow?.kind === 'font' ? optionId(active) : undefined}
          aria-label="Search fonts"
          placeholder="Search fonts"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (listRef.current) listRef.current.scrollTop = 0;
            setScrollTop(0);
          }}
          onKeyDown={onKeyDown}
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      {googleFonts ? (
        <div role="group" aria-label="Category" className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
          {[{ value: null, label: 'All' }, ...FONT_CATEGORIES].map((chip) => (
            <button
              key={chip.value ?? 'all'}
              type="button"
              aria-pressed={category === chip.value}
              onClick={() => {
                setCategory(chip.value);
                if (listRef.current) listRef.current.scrollTop = 0;
                setScrollTop(0);
              }}
              className={cn(
                'h-6 rounded-full px-2 text-[11px] text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent',
                category === chip.value && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Fonts"
        tabIndex={-1}
        className="relative overflow-y-auto p-1"
        style={{ height: LIST_HEIGHT }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.map((row, offset) => {
            const index = first + offset;
            const style = { position: 'absolute' as const, top: index * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT };
            if (row.kind === 'header') {
              return (
                <div key={row.key} role="presentation" style={style} className="flex items-end px-2 pb-1 text-[11px] font-medium text-fg-subtle">
                  {row.label}
                </div>
              );
            }
            const selected = index === selectedIndex;
            return (
              <div
                key={row.key}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                aria-checked={selected}
                style={style}
                onPointerMove={() => index !== active && setActive(index)}
                onClick={() => onPick(row)}
                className={cn('flex cursor-default select-none items-center gap-2 rounded-md px-2 text-[14px]', index === active && 'bg-hover')}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">{selected ? <Check className="size-3.5 text-accent" /> : null}</span>
                <span className="min-w-0 flex-1 truncate" style={{ fontFamily: fontFamilyCss(row.family, row.category) }}>
                  {row.family}
                </span>
                {row.detail ? <span className="shrink-0 truncate text-[11px] text-fg-subtle">{row.detail}</span> : null}
                {row.google && row.google.axes.length ? (
                  <span className="shrink-0 text-[10px] text-fg-subtle" title={row.google.axes.map((axis) => `${axis.tag} ${axis.min}–${axis.max}`).join(', ')}>
                    Variable
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {!rows.length ? (
          <div className="absolute inset-x-0 top-8 px-3 text-center text-xs text-fg-subtle">
            {googleFonts && !catalog && !catalogError ? 'Loading fonts…' : 'No fonts match'}
          </div>
        ) : null}
        {googleFonts && !catalog && !catalogError && rows.length ? (
          <div className="sticky bottom-0 bg-surface px-2 py-1 text-[11px] text-fg-subtle">Loading Google Fonts…</div>
        ) : null}
      </div>
    </div>
  );
}
