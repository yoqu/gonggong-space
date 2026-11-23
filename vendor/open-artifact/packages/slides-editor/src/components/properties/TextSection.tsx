/**
 * The Text section of the properties panel, in the order of the reference
 * editor: Text style, Font, Weight, Size, Spacing (line height and letter
 * spacing), Color (a color, gradient or picture, with its contrast), then
 * the optional Emphasis, List and Case rows its "+" adds, Align, and Resize
 * (what happens when the text outgrows its box).
 *
 * Inherited values are shown as they render (read off the stage), so an
 * unset field still says what is in effect; a row's reset button clears the
 * element's own value.
 */

import { Popover as BasePopover } from '@base-ui/react/popover';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Check, ChevronDown, Plus, Strikethrough, Underline } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  formatBackground,
  isTextual,
  parseBackground,
  setListKind,
  type Background,
  type FitMode,
  type SlideNode,
  type TextNode,
} from '@open-artifact/slides-core';
import { cn } from '@open-artifact/ui';
import { ChromeMenu, ChromeMenuItem } from '@open-artifact/editor-kit/react';
import { useDeck } from '../../state/deck.ts';
import { updateSelection } from '../../services/commands.ts';
import {
  faceStack,
  firstFamily,
  GENERIC_CHOICES,
  googleFace,
  GOOGLE_FONTS,
  googleFont,
  loadMenuFonts,
  parseVariantKey,
  variantChoices,
  variantKey,
  variantLabel,
  WEB_SAFE_FONTS,
  type FontVariant,
} from '../../lib/fonts.ts';
import { ColorRow, useColorGroups } from './ColorField.tsx';
import { fillKindOf, fillKindOptions, fillPreview, ImageFillEditor, startGradient, type FillKind } from './Fills.tsx';
import { GradientEditor } from './GradientEditor.tsx';
import { LetterSpacingIcon, LineHeightIcon, TypeScaleIcon } from './icons.tsx';
import { FIELD, IconButton, NumberInput, Row, Section, Segmented, SelectInput, TextInput, type Option } from './kit.tsx';
import { useResolvedText, type ResolvedText } from './resolve.ts';
import { canCarryFace, commitCss, commitFontFamily, contrastFor, FACE_LIMIT_REASON, patchTarget, pxOf, sharedStyle, useTextStyleMenu, type Target } from './shared.tsx';

const ALIGNS = [
  ['left', 'Left', AlignLeft],
  ['center', 'Center', AlignCenter],
  ['right', 'Right', AlignRight],
  ['justify', 'Justify', AlignJustify],
] as const;

const CASES: Option<string>[] = [
  { value: 'none', label: 'None' },
  { value: 'uppercase', label: 'Uppercase' },
  { value: 'lowercase', label: 'Lowercase' },
  { value: 'capitalize', label: 'Capitalize' },
];

const FITS: Option<FitMode>[] = [
  { value: 'shrink', label: 'Shrink text to fit' },
  { value: 'none', label: 'Don’t resize text' },
  { value: 'grow', label: 'Grow box to fit text' },
];

const RESIZE_TIP = 'What happens when the text outgrows its box: shrink the text, leave it as it is, or grow the box.';

/** Rows the "+" adds. */
type Extra = 'emphasis' | 'list' | 'case';

/** True when the node has text this section styles. */
function hasText(node: SlideNode): boolean {
  return isTextual(node) || node.kind === 'table';
}

/** Normalizes a weight value to a number. */
function weightOf(value: string | undefined): number | null {
  if (!value) return null;
  if (value === 'bold') return 700;
  if (value === 'normal') return 400;
  return /^\d{3}$/.test(value) ? Number(value) : null;
}

/** Text styling of the selected text elements. */
export function TextSection({ target }: { target: Target }): ReactNode {
  const isSlide = target.nodes.length === 0;
  const allText = !isSlide && target.nodes.every((n) => n.kind === 'text');
  const styleMenu = useTextStyleMenu(allText ? (target.nodes as TextNode[]) : null);
  const resolved = useResolvedText(isSlide ? [] : target.paths);
  const selectionKey = target.paths.map((p) => p.join('.')).join('|');
  const [extras, setExtras] = useState<ReadonlySet<Extra>>(new Set());
  useEffect(() => setExtras(new Set()), [selectionKey]);
  if (!isSlide && !target.nodes.every(hasText)) return null;

  const size = sharedStyle(target, 'font-size');
  const lineHeight = sharedStyle(target, 'line-height');
  const spacing = sharedStyle(target, 'letter-spacing');
  const transform = sharedStyle(target, 'text-transform');
  const decoration = sharedStyle(target, 'text-decoration');
  const align = sharedStyle(target, 'text-align');
  const line = decoration.mixed ? null : /line-through/.test(decoration.value ?? '') ? 'line-through' : /underline/.test(decoration.value ?? '') ? 'underline' : null;
  const canList = !isSlide && target.nodes.every((n) => n.kind === 'text' || n.kind === 'list');
  const listKind = canList ? (target.nodes.every((n) => n.kind === 'list' && n.tag === 'ul') ? 'ul' : target.nodes.every((n) => n.kind === 'list' && n.tag === 'ol') ? 'ol' : target.nodes.every((n) => n.kind === 'text') ? 'none' : null) : null;
  const canFit = !isSlide;
  const fits = target.nodes.map((n) => n.fit ?? 'shrink');
  const fit = fits.every((f) => f === fits[0]) ? (fits[0] ?? 'shrink') : null;

  const showEmphasis = !isSlide && (extras.has('emphasis') || decoration.mixed || line !== null);
  const showList = canList && (extras.has('list') || target.nodes.some((n) => n.kind === 'list'));
  const showCase = extras.has('case') || transform.mixed || Boolean(transform.value && transform.value !== 'none');
  const add = (extra: Extra): void => setExtras(new Set([...extras, extra]));

  const n = target.nodes.length;
  const title = n > 1 ? `${n} Text` : 'Text';
  const menu = (
    <ChromeMenu
      align="end"
      tip={{ label: 'Add to Text' }}
      trigger={
        <button type="button" aria-label="Add to Text" className="flex size-6 items-center justify-center rounded-[6px] text-chrome-secondary outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:ring-2 focus-visible:ring-chrome-accent">
          <Plus className="size-4" strokeWidth={1.5} />
        </button>
      }
    >
      {!isSlide ? (
        <ChromeMenuItem disabled={showEmphasis} onSelect={() => add('emphasis')}>
          Emphasis
        </ChromeMenuItem>
      ) : null}
      {canList ? (
        <ChromeMenuItem disabled={showList} onSelect={() => add('list')}>
          List
        </ChromeMenuItem>
      ) : null}
      <ChromeMenuItem disabled={showCase} onSelect={() => add('case')}>
        Case
      </ChromeMenuItem>
    </ChromeMenu>
  );

  const spacingSet = Boolean(lineHeight.value || spacing.value);
  const letterValue = spacing.mixed || !spacing.value ? null : spacing.value.endsWith('em') ? Math.round(Number.parseFloat(spacing.value) * (resolved?.size ?? 16) * 10) / 10 : pxOf(spacing.value);

  return (
    <Section title={title} actions={menu}>
      {allText ? (
        <Row label="Text style">
          <SelectInput
            aria-label="Text style"
            icon={<TypeScaleIcon />}
            value={styleMenu.value}
            placeholder={styleMenu.mixed ? 'Mixed' : 'Custom'}
            options={styleMenu.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint, group: o.group, style: o.style }))}
            valueStyle={{}}
            onChange={styleMenu.apply}
          />
        </Row>
      ) : null}
      <FontRow target={target} resolved={resolved} isSlide={isSlide} />
      <WeightRow target={target} resolved={resolved} />
      <Row label="Size" onReset={size.value && !size.mixed ? () => commitCss(target, 'font-size', '', 'Font size') : undefined}>
        <NumberInput
          aria-label="Font size"
          value={size.mixed ? null : pxOf(size.value)}
          unit="px"
          min={8}
          max={400}
          placeholder={size.mixed ? 'Mixed' : resolved ? String(resolved.size) : 'Auto'}
          inherited={!size.mixed}
          onCommit={(v) => commitCss(target, 'font-size', v === null ? '' : `${v}px`, 'Font size')}
        />
      </Row>
      <Row
        label="Spacing"
        tip="Line height · Letter spacing"
        resetLabel="Reset Spacing"
        onReset={spacingSet ? () => patchTarget(target, 'Spacing', { 'line-height': undefined, 'letter-spacing': undefined }) : undefined}
      >
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          <NumberInput
            aria-label="Line height"
            title="Line height"
            label={<LineHeightIcon />}
            value={lineHeight.mixed || !lineHeight.value ? null : Number.parseFloat(lineHeight.value)}
            step={0.05}
            min={0.5}
            max={4}
            steppers={false}
            placeholder={lineHeight.mixed ? 'Mixed' : resolved?.lineHeight != null ? String(resolved.lineHeight) : 'Auto'}
            inherited={!lineHeight.mixed}
            onCommit={(v) => commitCss(target, 'line-height', v === null ? '' : String(v), 'Line height')}
          />
          <NumberInput
            aria-label="Letter spacing"
            title="Letter spacing (px)"
            label={<LetterSpacingIcon />}
            value={letterValue}
            step={0.5}
            min={-24}
            max={32}
            steppers={false}
            placeholder={spacing.mixed ? 'Mixed' : String(resolved?.letterSpacing ?? 0)}
            inherited={!spacing.mixed}
            onCommit={(v) => commitCss(target, 'letter-spacing', v === null || v === 0 ? '' : `${v}px`, 'Letter spacing')}
          />
        </div>
      </Row>
      <TextColorRow target={target} resolved={resolved} />
      {showEmphasis ? (
        <Row label="Emphasis" onReset={line ? () => commitCss(target, 'text-decoration', '', 'Emphasis') : undefined}>
          <IconButton label="Underline" icon={<Underline />} active={line === 'underline'} onClick={() => commitCss(target, 'text-decoration', line === 'underline' ? '' : 'underline', 'Underline')} />
          <IconButton label="Strikethrough" icon={<Strikethrough />} active={line === 'line-through'} onClick={() => commitCss(target, 'text-decoration', line === 'line-through' ? '' : 'line-through', 'Strikethrough')} />
        </Row>
      ) : null}
      {showList ? (
        <Row label="List">
          <Segmented<'none' | 'ul' | 'ol'>
            aria-label="List"
            value={listKind}
            options={[
              { value: 'none', label: 'None' },
              { value: 'ul', label: 'Bulleted' },
              { value: 'ol', label: 'Numbered' },
            ]}
            onChange={(kind) => updateSelection('List', (node) => (node.kind === 'text' || node.kind === 'list' ? setListKind(node, kind === 'none' ? null : kind) : node))}
          />
        </Row>
      ) : null}
      <Row label="Align" onReset={align.value && !align.mixed ? () => commitCss(target, 'text-align', '', 'Align') : undefined}>
        <Segmented
          aria-label="Text alignment"
          value={align.mixed ? null : (align.value ?? resolved?.align ?? 'left')}
          options={ALIGNS.map(([value, title, Icon]) => ({ value, title, label: <Icon className="size-4" strokeWidth={1.5} /> }))}
          onChange={(value) => commitCss(target, 'text-align', value, 'Align')}
        />
      </Row>
      {showCase ? (
        <Row label="Case" onReset={transform.value && !transform.mixed ? () => commitCss(target, 'text-transform', '', 'Text case') : undefined}>
          <SelectInput
            aria-label="Text case"
            value={transform.mixed ? null : (transform.value ?? 'none')}
            placeholder="Mixed"
            options={CASES}
            onChange={(value) => commitCss(target, 'text-transform', value === 'none' ? '' : value, 'Text case')}
          />
        </Row>
      ) : null}
      {canFit ? (
        <Row label="Resize" tip={RESIZE_TIP}>
          <SelectInput<FitMode>
            aria-label="Resize"
            title={RESIZE_TIP}
            value={fit}
            placeholder="Mixed"
            options={FITS}
            onChange={(mode) =>
              updateSelection('Resize', (node) => {
                const { fit: _old, ...rest } = node;
                return (mode === 'shrink' ? rest : { ...rest, fit: mode }) as SlideNode;
              })
            }
          />
        </Row>
      ) : null}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Font                                                                        */
/* -------------------------------------------------------------------------- */

/** One entry of the font menu. */
interface FontChoice {
  key: string;
  label: string;
  /** What `font-family` becomes ('' clears it). */
  css: string;
  /** The web font the deck must carry for it. */
  google?: boolean;
  /** The label's own font. */
  preview?: string;
  disabled?: boolean;
}

/** The menu key of a stored `font-family`. */
function choiceKey(value: string | undefined): string {
  if (!value) return '';
  const first = firstFamily(value);
  if (!first) return '';
  const lower = first.toLowerCase();
  const generic = GENERIC_CHOICES.find((c) => c.key === lower);
  return generic ? generic.key : `face:${lower}`;
}

/** The Font row: a searchable menu of the deck's faces, the generic families and the catalog. */
function FontRow({ target, resolved, isSlide }: { target: Target; resolved: ResolvedText | null; isSlide: boolean }): ReactNode {
  const deckFaces = useDeck((s) => s.index.faces);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shared = sharedStyle(target, 'font-family');
  const current = shared.mixed ? null : choiceKey(shared.value);
  const room = useMemo(() => canCarryFace(), [deckFaces, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = useMemo((): FontChoice[] => {
    const carried = Object.values(deckFaces).map((f) => f.family);
    const carriedLower = new Set(carried.map((f) => f.toLowerCase()));
    const out: FontChoice[] = [{ key: '', label: isSlide ? 'System font' : 'Style default', css: '' }];
    for (const family of carried) out.push({ key: `face:${family.toLowerCase()}`, label: family, css: faceStack(family), preview: faceStack(family) });
    const own = shared.mixed ? null : firstFamily(shared.value);
    const known = (name: string): boolean =>
      carriedLower.has(name.toLowerCase()) || GENERIC_CHOICES.some((c) => c.key === name.toLowerCase()) || Boolean(googleFont(name)) || WEB_SAFE_FONTS.some((f) => f.family.toLowerCase() === name.toLowerCase());
    if (own && !known(own)) out.push({ key: `face:${own.toLowerCase()}`, label: own, css: shared.value!, preview: shared.value });
    for (const generic of GENERIC_CHOICES) out.push({ key: generic.key, label: generic.label, css: generic.css, preview: generic.css });
    const catalog = [...WEB_SAFE_FONTS.map((f) => ({ family: f.family, google: false })), ...GOOGLE_FONTS.map((f) => ({ family: f.family, google: true }))]
      .filter((f) => !carriedLower.has(f.family.toLowerCase()))
      .sort((a, b) => a.family.localeCompare(b.family));
    for (const font of catalog) {
      out.push({ key: `face:${font.family.toLowerCase()}`, label: font.family, css: faceStack(font.family), preview: faceStack(font.family), google: font.google, disabled: font.google && !room });
    }
    return out;
  }, [deckFaces, shared.value, shared.mixed, isSlide, room]);

  const q = query.trim().toLowerCase();
  const shown = q ? choices.filter((c) => c.label.toLowerCase().includes(q)) : choices;
  const selected = choices.find((c) => c.key === current);
  const rendered = resolved?.family && !/^(?:system-ui|-apple-system|blinkmacsystemfont)$/i.test(resolved.family) ? resolved.family : 'System font';
  const label = shared.mixed ? 'Mixed' : current ? (selected?.label ?? firstFamily(shared.value) ?? '') : resolved ? rendered : isSlide ? 'System font' : 'Style default';

  const choose = (choice: FontChoice): void => {
    setOpen(false);
    setQuery('');
    if (choice.google) {
      const font = googleFont(choice.label)!;
      commitFontFamily(target, choice.css, googleFace(font));
    } else commitFontFamily(target, choice.css, null);
  };

  return (
    <Row label="Font" onReset={shared.value && !shared.mixed ? () => commitCss(target, 'font-family', '', 'Font') : undefined}>
      <BasePopover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) loadMenuFonts();
          else setQuery('');
        }}
      >
        <BasePopover.Trigger aria-label={`Font: ${label}`} className={cn(FIELD, 'flex w-full min-w-0 cursor-default items-center gap-1.5 pl-2 pr-[5px] text-left data-[popup-open]:shadow-[inset_0_0_0_1px_var(--color-chrome-accent)]')}>
          <span className={cn('min-w-0 flex-1 truncate', shared.mixed ? 'text-chrome-muted' : !current && 'text-chrome-secondary')}>{label}</span>
          <ChevronDown className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
        </BasePopover.Trigger>
        <BasePopover.Portal>
          <BasePopover.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} className="z-[1000]">
            <BasePopover.Popup className="flex w-64 flex-col overflow-hidden rounded-[14px] bg-chrome text-chrome-fg shadow-chrome-popup outline-none">
              <div className="p-2 pb-1">
                <TextInput autoFocus aria-label="Search fonts" placeholder="Search fonts" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <div role="listbox" aria-label="Fonts" className="max-h-80 overflow-y-auto p-1.5 pt-1">
                {shown.map((choice) => (
                  <button
                    key={choice.key || 'default'}
                    type="button"
                    role="option"
                    aria-selected={choice.key === current}
                    disabled={choice.disabled}
                    title={choice.disabled ? FACE_LIMIT_REASON : undefined}
                    onClick={() => choose(choice)}
                    className="flex h-7 w-full cursor-default items-center gap-2 rounded-[8px] pl-2 pr-2.5 text-left text-[13px] outline-none hover:bg-chrome-hover focus-visible:bg-chrome-hover disabled:opacity-40"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">{choice.key === current ? <Check className="size-4 text-chrome-accent" strokeWidth={2.25} /> : null}</span>
                    <span className="min-w-0 flex-1 truncate" style={choice.preview ? { fontFamily: choice.preview } : undefined}>
                      {choice.label}
                    </span>
                  </button>
                ))}
                {shown.length === 0 ? <p className="px-2 py-2 text-[12px] text-chrome-muted">No matches</p> : null}
              </div>
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    </Row>
  );
}

/** The Weight row: the family's weights and italics. */
function WeightRow({ target, resolved }: { target: Target; resolved: ResolvedText | null }): ReactNode {
  const family = sharedStyle(target, 'font-family');
  const weight = sharedStyle(target, 'font-weight');
  const style = sharedStyle(target, 'font-style');
  const mixed = weight.mixed || style.mixed;
  const set = weight.value !== undefined || style.value !== undefined;
  const effective: FontVariant | null = resolved ? { weight: resolved.weight, italic: resolved.italic } : null;
  const own: FontVariant | null = set ? { weight: weightOf(weight.value) ?? effective?.weight ?? 400, italic: style.value === 'italic' } : null;
  const familyName = (family.mixed ? null : firstFamily(family.value)) ?? resolved?.family ?? null;
  const options = variantChoices(familyName, own ?? effective).map((v) => ({ value: variantKey(v), label: variantLabel(v) }));
  return (
    <Row label="Weight" onReset={set && !mixed ? () => patchTarget(target, 'Font weight', { 'font-weight': undefined, 'font-style': undefined }) : undefined}>
      <SelectInput
        aria-label="Weight"
        value={mixed || !own ? null : variantKey(own)}
        placeholder={mixed ? 'Mixed' : effective ? variantLabel(effective) : 'Regular'}
        inherited={!mixed}
        options={options}
        onChange={(key) => {
          const v = parseVariantKey(key);
          if (v) patchTarget(target, 'Font weight', { 'font-weight': String(v.weight), 'font-style': v.italic ? 'italic' : undefined });
        }}
      />
    </Row>
  );
}

/* -------------------------------------------------------------------------- */
/* Color                                                                       */
/* -------------------------------------------------------------------------- */

/** Clipping that paints the background through the glyphs. */
const CLIP_ON = { 'background-clip': 'text', '-webkit-text-fill-color': 'transparent' } as const;
const CLIP_OFF = { background: undefined, 'background-clip': undefined, '-webkit-text-fill-color': undefined } as const;

const CHECKER = 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px';

/** The text Color row: a color (with contrast), or a gradient or picture painted through the letters. */
function TextColorRow({ target, resolved }: { target: Target; resolved: ResolvedText | null }): ReactNode {
  const groups = useColorGroups();
  const color = sharedStyle(target, 'color');
  const bg = sharedStyle(target, 'background');
  const clip = sharedStyle(target, 'background-clip');
  const canFill = target.nodes.length > 0 && target.nodes.every((n) => isTextual(n));
  const clipped = !clip.mixed && clip.value === 'text';
  const parsed = clipped && !bg.mixed && bg.value ? parseBackground(bg.value) : null;
  const background: Background | null = parsed?.ok ? parsed.value : null;
  const stored: FillKind = clipped ? fillKindOf(background) : 'color';
  const [pending, setPending] = useState<FillKind | null>(null);
  const kind = pending ?? stored;
  useEffect(() => setPending(null), [stored]);

  const setFill = (next: Background, label: string, coalesce?: string): void => {
    patchTarget(target, label, { background: formatBackground(next), ...CLIP_ON }, coalesce);
  };
  const setKind = (next: FillKind): void => {
    if (next === 'color') {
      setPending(null);
      if (clipped) patchTarget(target, 'Text fill', CLIP_OFF);
    } else if (next === 'gradient') {
      setPending(null);
      setFill({ gradient: background?.gradient ?? startGradient(color.value ?? resolved?.color) }, 'Gradient text');
    } else setPending('image');
  };
  const content =
    kind === 'gradient' && background?.gradient ? (
      <GradientEditor gradient={background.gradient} onChange={(gradient) => setFill({ gradient }, 'Text gradient', 'text-gradient')} />
    ) : kind === 'image' ? (
      <ImageFillEditor image={background?.image ?? null} onImage={(image) => setFill({ image }, 'Picture text')} />
    ) : null;
  const preview = kind === 'color' ? null : (fillPreview(background) ?? { swatch: CHECKER, label: kind === 'image' ? 'Image' : 'Linear' });
  const value = color.mixed ? null : (color.value ?? null);
  const contrast =
    kind === 'color' && !color.mixed
      ? contrastFor(target, { kind: 'text', color: value ?? resolved?.color ?? null, ...(resolved ? { size: resolved.size, weight: resolved.weight } : {}) })
      : null;

  return (
    <ColorRow
      label="Color"
      aria-label="Text color"
      value={value}
      mixed={color.mixed}
      effective={resolved?.color ?? null}
      emptyLabel="Theme default"
      groups={groups}
      preview={preview}
      contrast={contrast}
      onReset={value ? () => commitCss(target, 'color', '', 'Text color') : undefined}
      onCommit={(next) => {
        setPending(null);
        patchTarget(target, 'Text color', { color: next ?? undefined, ...(clipped ? CLIP_OFF : {}) }, 'text-color');
      }}
      {...(canFill ? { kinds: { value: kind, options: fillKindOptions(['color', 'gradient', 'image']), onChange: (v: string) => setKind(v as FillKind), content } } : {})}
    />
  );
}
