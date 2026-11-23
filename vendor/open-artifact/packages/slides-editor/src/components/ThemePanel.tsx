/**
 * The Theme tab of the properties panel: restyle the whole deck from an
 * installed design system's look.
 *
 * - Looks: "Original look" (the deck as it was before any restyle), then
 *   every theme of every installed system (up to eight each) as a tile with
 *   its ground, ink and accent. Picking one rewrites every slide's colours
 *   and its heading and body faces as one undo step; the arrow keys move
 *   between looks and apply them as they go.
 * - Recent: the deck remembers its last two looks, to switch straight back.
 * - Slides still wearing an earlier look (added in the old palette) are
 *   pointed out, with "Apply to all slides".
 * - Fonts: the heading and body typefaces across the deck.
 * - Palette: the colour roles the deck's colours were read as.
 */

import { useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Bot, Check, Paintbrush } from 'lucide-react';
import { cn } from '@open-artifact/ui';
import { deckOrder, useDeck } from '../state/deck.ts';
import { sendToAgent, useAgent } from '../services/agent.ts';
import { useDesignSystems } from '../services/design-systems.ts';
import { MAX_RESTYLE_COLORS } from '../services/theme/analysis.ts';
import { ORIGINAL_LOOK, readThemeMemory } from '../services/theme/restyle.ts';
import { ROLE_LABELS } from '../services/theme/system.ts';
import { applyCurrentLookToAll, applyLook, familyChoices, lookOptions, lookTitle, readThemeState, setDeckFamily, type LookOption } from '../services/theme/theme.ts';
import { Button, Note, Row, Section, SelectInput } from './properties/kit.tsx';

/** A strip of colour chips. */
function Swatches({ colors, className }: { colors: readonly string[]; className?: string }): ReactNode {
  return (
    <span className={cn('flex shrink-0 overflow-hidden rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]', className)} aria-hidden>
      {colors.map((color, i) => (
        <span key={i} className="h-full w-3" style={{ background: color }} />
      ))}
    </span>
  );
}

/** One look tile: a small slide in the look's ground, ink and accent, and its name. */
function LookTile({ option, current, onPick, tabStop }: { option: LookOption; current: boolean; onPick: () => void; tabStop: boolean }): ReactNode {
  const [ground, ink, accent] = option.swatches;
  const fonts = [option.heading, option.body].filter((f, i, all): f is string => Boolean(f) && all.indexOf(f) === i).join(' · ');
  return (
    <button
      type="button"
      role="option"
      aria-selected={current}
      data-look={option.id}
      tabIndex={tabStop ? 0 : -1}
      onClick={onPick}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-[8px] p-1.5 text-left outline-none hover:bg-chrome-hover focus-visible:shadow-[inset_0_0_0_1px_var(--color-chrome-accent)]',
        current && 'bg-chrome-hover',
      )}
    >
      <span className="relative flex h-9 w-16 shrink-0 flex-col justify-center gap-1 overflow-hidden rounded-[4px] px-1.5 shadow-[0_0_0_1px_var(--chrome-line)]" style={{ background: ground }} aria-hidden>
        <span className="h-1.5 w-8 rounded-full" style={{ background: ink }} />
        <span className="h-1 w-10 rounded-full opacity-60" style={{ background: ink }} />
        <span className="absolute bottom-1 right-1.5 size-2.5 rounded-full" style={{ background: accent }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-chrome-fg">{option.title}</span>
        {option.subtitle || fonts ? <span className="truncate text-[11px] text-chrome-muted">{[option.subtitle, fonts].filter(Boolean).join(' — ')}</span> : null}
      </span>
      {current ? <Check className="size-4 shrink-0 text-chrome-accent" strokeWidth={2} /> : null}
    </button>
  );
}

const DEFAULT_FACE = '\u0000default';

/** The Theme tab. */
export function ThemePanel(): ReactNode {
  const slides = useDeck((s) => s.slides);
  const index = useDeck((s) => s.index);
  const readOnly = useDeck((s) => s.readOnly);
  const systems = useDesignSystems((s) => s.systems);
  const agent = useAgent((s) => s.status);
  const list = useRef<HTMLDivElement>(null);

  const entries = useMemo(
    () =>
      deckOrder({ index, slides })
        .map((id) => ({ id, entry: slides[id] }))
        .filter((x): x is { id: string; entry: NonNullable<typeof x.entry> } => Boolean(x.entry && !x.entry.held))
        .map(({ id, entry }) => ({ id, slide: entry.slide })),
    [index, slides],
  );
  const memoryRaw = useMemo(() => readThemeMemory(index), [index]);
  const state = useMemo(() => readThemeState(entries, memoryRaw, systems), [entries, memoryRaw, systems]);
  const { analysis, memory, current, strays } = state;

  const original: LookOption = useMemo(() => {
    const colors = memory?.original.colors ?? Object.fromEntries(analysis.slots.map((s) => [s.id, s.value]));
    const pick = (...ids: string[]): string => ids.map((id) => colors[id]).find(Boolean) ?? '#ffffff';
    return {
      id: ORIGINAL_LOOK,
      title: 'Original look',
      subtitle: 'How the deck looked before',
      swatches: [pick('background', 'surface'), pick('text', 'muted', 'on-inverse'), pick('accent', 'text'), pick('surface', 'background'), pick('muted', 'text')],
    };
  }, [memory, analysis]);
  const options = useMemo(() => lookOptions(systems, original), [systems, original]);
  const titleOf = (id: string): string => {
    const found = options.find((o) => o.id === id);
    return found ? lookTitle(found) : (memory?.recent.find((r) => r.look === id)?.title ?? 'an earlier look');
  };

  const pick = (id: string): void => {
    if (readOnly) return;
    if (id === current) return;
    if (id === ORIGINAL_LOOK && !memory) return;
    applyLook(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-look]') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, (at < 0 ? 0 : at) + (event.key === 'ArrowDown' ? 1 : -1)));
    const button = buttons[next];
    if (!button) return;
    event.preventDefault();
    button.focus();
    // Moving between looks applies them as it goes (each one undo step).
    pick(button.dataset.look ?? '');
  };

  const choices = useMemo(() => familyChoices(index.faces, systems), [index.faces, systems]);
  const fontOptions = useMemo(
    () => [
      { value: DEFAULT_FACE, label: 'Default (system font)', group: 'Default' },
      ...choices.map((c) => ({ value: c.family.toLowerCase(), label: c.family, group: c.group, style: { fontFamily: `"${c.family}"` } })),
    ],
    [choices],
  );
  const fontValue = (key: string): string => (key === '' ? DEFAULT_FACE : key);
  const withCurrent = (key: string): typeof fontOptions =>
    key && !fontOptions.some((o) => o.value === key) ? [{ value: key, label: key, group: 'In this deck', style: { fontFamily: `"${key}"` } }, ...fontOptions] : fontOptions;
  const familyOf = (value: string): string => (value === DEFAULT_FACE ? '' : (choices.find((c) => c.family.toLowerCase() === value)?.family ?? value));

  const recent = memory?.recent.slice(1).filter((r) => r.look !== current) ?? [];
  const disabled = readOnly;

  return (
    <div className="flex min-w-0 flex-col">
      <Section title="Look">
        {systems.length === 0 ? (
          <>
            <Note>Install a design system in this deck to restyle every slide from its colors and fonts.</Note>
            {agent.available && !readOnly ? (
              <div className="px-4 py-1">
                <Button
                  variant="secondary"
                  icon={<Bot />}
                  onClick={() => void sendToAgent('Install a design system in this deck (copy it under project/ds/ and list it in deck.json designSystems) so I can restyle the slides from the Theme panel.')}
                >
                  Ask {agent.name} to add one
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {!memory && analysis.over ? (
          <Note>
            This deck uses {analysis.distinct} colors (at most {MAX_RESTYLE_COLORS} can be restyled automatically). Ask {agent.name} to redo its look instead.
          </Note>
        ) : null}
        <div ref={list} role="listbox" aria-label="Looks" aria-disabled={disabled || undefined} onKeyDown={onKeyDown} className={cn('flex flex-col gap-0.5 px-2.5', disabled && 'pointer-events-none opacity-50')}>
          {options
            .filter((o) => o.id !== ORIGINAL_LOOK || memory)
            .map((option) => (
              <LookTile key={option.id || 'original'} option={option} current={option.id === current} tabStop={option.id === current || (!memory && option === options[1])} onPick={() => pick(option.id)} />
            ))}
          {!memory && systems.length > 0 ? <Note className="px-1.5">The deck wears its own look. Pick one to restyle every slide; Original look brings it back.</Note> : null}
        </div>
        {recent.length ? (
          <Row label="Recent">
            {recent.map((r) => (
              <Button key={r.look || 'original'} variant="ghost" className="min-w-0 truncate px-1.5" disabled={disabled} onClick={() => pick(r.look)} title={`Switch back to ${titleOf(r.look)}`}>
                <Swatches className="h-3" colors={[r.colors.background, r.colors.text, r.colors.accent].filter((c): c is string => Boolean(c))} />
                <span className="truncate">{titleOf(r.look)}</span>
              </Button>
            ))}
          </Row>
        ) : null}
        {strays.length && memory?.recent[0] ? (
          <div className="mx-4 mt-1 flex flex-col gap-1.5 rounded-[8px] bg-chrome-field p-2.5">
            <span className="text-[12px] leading-[1.45] text-chrome-fg">
              {strays.length === 1 ? '1 slide still uses' : `${strays.length} slides still use`} colors from an earlier look. Make {strays.length === 1 ? 'it' : 'them'} {titleOf(current)} too?
            </span>
            <Button variant="secondary" icon={<Paintbrush />} disabled={disabled} onClick={applyCurrentLookToAll} className="self-start">
              Apply to all slides
            </Button>
          </div>
        ) : null}
      </Section>
      <Section title="Fonts">
        <Row label="Headings" tip="The typeface of every heading in the deck">
          <SelectInput<string>
            aria-label="Heading font"
            value={fontValue(analysis.heading)}
            options={withCurrent(analysis.heading)}
            disabled={disabled}
            onChange={(value) => setDeckFamily('heading', familyOf(value))}
          />
        </Row>
        <Row label="Body" tip="The typeface of body text across the deck">
          <SelectInput<string>
            aria-label="Body font"
            value={fontValue(analysis.body)}
            options={withCurrent(analysis.body)}
            disabled={disabled}
            onChange={(value) => setDeckFamily('body', familyOf(value))}
          />
        </Row>
        <Note>A presentation carries up to four typefaces; changing a font is one undo step.</Note>
      </Section>
      {analysis.slots.length ? (
        <Section title="Palette" collapsible>
          <div className="flex flex-col gap-0.5 px-4">
            {analysis.slots.slice(0, 24).map((slot) => (
              <div key={slot.id} className="flex min-h-6 items-center gap-2 text-[12px]">
                <span className="size-4 shrink-0 rounded-[4px] shadow-[0_0_0_1px_var(--chrome-line)]" style={{ background: slot.value }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-chrome-fg">
                  {ROLE_LABELS[slot.role]}
                  {/-\d+$/.test(slot.id) ? ` ${slot.id.split('-').at(-1)}` : ''}
                </span>
                <span className="font-mono text-[11px] text-chrome-muted">{slot.value}</span>
              </div>
            ))}
          </div>
          <Note>How the deck’s colors were read. A look maps each role to the design system’s matching color.</Note>
        </Section>
      ) : null}
    </div>
  );
}
