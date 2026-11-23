import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ChromeButton, ChromePopover } from '@open-artifact/editor-kit/react';
import { cn } from '@open-artifact/ui';
import { FONT_PANEL_WORDS } from '@open-artifact/motion-core';
import type { FontOption } from './font-rows.ts';
import { loadBuiltinPreview, loadGooglePreviews, previewFontFamily, useFontPreviews } from './font-previews.ts';
import { searchFonts } from './font-search.ts';
import { MORE_GOOGLE_FONTS, NO_FONTS_MATCH, SEARCH_FONTS } from './words.ts';

export interface FontMenuProps {
  /** The row's name, for the menu's accessible name. */
  label: string;
  value: string;
  options: readonly FontOption[];
  /** What the film's own choice is called beside "Original" (its typeface, or "Same as Body"). */
  originalHint: string;
  disabled: boolean;
  /** The pick is not shown (the film lacks letters for it): the trigger reads as the film's own. */
  mute: boolean;
  /** Whether a Google family may be picked (the film is not at its family limit, or already uses it). */
  allows: (option: FontOption) => boolean;
  onPick: (value: string) => void;
}

interface Group {
  label: string | null;
  options: FontOption[];
}

function groupsOf(options: readonly FontOption[], more: readonly FontOption[]): Group[] {
  const groups: Group[] = [
    { label: null, options: options.filter((option) => option.value === '') },
    { label: FONT_PANEL_WORDS.builtinGroup, options: options.filter((option) => option.value !== '' && !option.google) },
    { label: FONT_PANEL_WORDS.googleGroup, options: options.filter((option) => option.value !== '' && option.google) },
    { label: MORE_GOOGLE_FONTS, options: [...more] },
  ];
  return groups.filter((group) => group.options.length > 0);
}

function OptionName({ option, originalHint }: { option: FontOption; originalHint: string }): ReactElement {
  const loaded = useFontPreviews((state) => state.loaded);
  if (option.value === '') {
    return (
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span>{FONT_PANEL_WORDS.original}</span>
        {originalHint === '' ? null : <span className="truncate text-[12px] text-chrome-muted">{originalHint}</span>}
      </span>
    );
  }
  const family = previewFontFamily(loaded, option);
  return (
    <span className="min-w-0 flex-1 truncate text-left" style={family === undefined ? undefined : { fontFamily: family, fontWeight: 600 }}>
      {option.name}
    </span>
  );
}

/** A slot's typeface: a button that opens a searchable list of the built-in and Google Fonts typefaces. */
export function FontMenu({ label, value, options, originalHint, disabled, mute, allows, onPick }: FontMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const shown = mute ? '' : value;
  const current = options.find((option) => option.value === shown) ?? options[0];

  const { options: matches, more } = useMemo(() => searchFonts(options, query), [options, query]);
  const groups = useMemo(() => groupsOf(matches, more), [matches, more]);
  const flat = useMemo(() => groups.flatMap((group) => group.options), [groups]);

  useEffect(() => {
    if (current?.face != null) loadBuiltinPreview(current.face);
    else if (current?.google === true) loadGooglePreviews([current.name]);
  }, [current]);

  useEffect(() => {
    if (!open) return;
    for (const option of flat) if (option.face !== null) loadBuiltinPreview(option.face);
    loadGooglePreviews(flat.filter((option) => option.google).map((option) => option.name));
  }, [open, flat]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, flat.findIndex((option) => option.value === shown)));
  }, [open, flat, shown]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (option: FontOption | undefined): void => {
    if (option === undefined || !allows(option)) return;
    setOpen(false);
    setQuery('');
    if (option.value !== shown) onPick(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (flat.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((at) => (at + step + flat.length) % flat.length);
        return;
      }
      case 'Home':
      case 'End':
        if (query !== '') return;
        event.preventDefault();
        setActive(event.key === 'Home' ? 0 : Math.max(0, flat.length - 1));
        return;
      case 'Enter':
        event.preventDefault();
        choose(flat[active]);
        return;
      default:
        return;
    }
  };

  let index = 0;
  return (
    <ChromePopover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      side="left"
      align="start"
      label={label}
      className="flex w-[260px] flex-col gap-1.5 p-1.5"
      trigger={
        <ChromeButton disabled={disabled} aria-label={`${label}: ${current === undefined || current.value === '' ? FONT_PANEL_WORDS.original : current.name}`} className="h-7 w-full min-w-0 justify-between bg-chrome-field px-2 text-[13px]">
          {current === undefined ? null : <OptionName option={current} originalHint={originalHint} />}
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-chrome-muted" />
        </ChromeButton>
      }
    >
      <input
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={flat.length === 0 ? undefined : `${listId}-${active}`}
        aria-label={SEARCH_FONTS}
        placeholder={SEARCH_FONTS}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="h-7 w-full min-w-0 rounded-[8px] border border-chrome-line bg-chrome-field px-2 text-[13px] text-chrome-fg outline-none placeholder:text-chrome-muted focus:border-chrome-accent"
      />
      <div ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-[320px] overflow-y-auto">
        {flat.length === 0 ? <p className="px-2 py-1.5 text-[13px] text-chrome-muted">{NO_FONTS_MATCH}</p> : null}
        {groups.map((group) => (
          <div key={group.label ?? 'original'} role="group" aria-label={group.label ?? FONT_PANEL_WORDS.original}>
            {group.label === null ? null : <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-chrome-muted">{group.label}</div>}
            {group.options.map((option) => {
              const at = index++;
              const allowed = allows(option);
              const selected = option.value === shown;
              return (
                <div
                  key={option.value}
                  id={`${listId}-${at}`}
                  data-index={at}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={!allowed}
                  onPointerMove={() => setActive(at)}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex h-7 cursor-default select-none items-center gap-2 rounded-[8px] px-2 text-[13px]',
                    at === active && 'bg-chrome-hover',
                    !allowed && 'opacity-40',
                  )}
                >
                  <OptionName option={option} originalHint={originalHint} />
                  {selected ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </ChromePopover>
  );
}
