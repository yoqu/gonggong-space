/**
 * CommentCard and its parts: same DOM, data attributes and class
 * strings, the raised card and the flat one (a row in a list, `onExpand` on a click away from its controls). Left out:
 * reactions, "show more" clamping, the toolbar's arrow-key roving, touch sizing at runtime.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Avatar,
  Button,
  Checkbox,
  cn,
  FIELD_CLASS,
  focusedIn,
  Icon,
  Menu,
  MenuItems,
  MenuPopup,
  panelClass,
  panelVars,
  PlainEditor,
  returnFocus,
  Tooltip,
  useCdsRoot,
  type MenuItemSpec,
} from './cds.tsx';

const CardContext = createContext({ expanded: false });
const InRepliesContext = createContext(false);
const CloseContext = createContext<{ onClose: () => void; closeLabel?: string } | null>(null);
const PlacementContext = createContext<'pinned' | 'float'>('float');
/** Set inside a ReplyField: the composer there is the card's reply box. */
export const ReplyFieldContext = createContext(false);

/** The "Send to Agent" checkbox under a composer or an edit field. */
export interface SendBoxSpec {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function SendBox({ box, disabled = false }: { box: SendBoxSpec; disabled?: boolean }) {
  return <Checkbox label={box.label} checked={box.checked} disabled={disabled} onCheckedChange={box.onCheckedChange} />;
}

/** Hover-revealed action group of a comment that is not pinned. */
const FLOAT =
  `pointer-events-none absolute inset-y-0 end-full ps-8 opacity-0 empty:hidden [&:not(:has(button,a[href],[role=button]))]:bg-none [&:not(:has(button,a[href],[role=button]))]:ps-0 bg-[linear-gradient(to_right,transparent,var(--cds-comment-card-row-tint,transparent)_30%),linear-gradient(to_right,transparent,var(--cds-comment-card-bg,var(--cds-page-bg))_30%)] rtl:bg-[linear-gradient(to_left,transparent,var(--cds-comment-card-row-tint,transparent)_30%),linear-gradient(to_left,transparent,var(--cds-comment-card-bg,var(--cds-page-bg))_30%)] group-hover/comment:pointer-events-auto group-hover/comment:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 has-[[data-resolving]]:pointer-events-auto has-[[data-resolving]]:opacity-100 touch:pointer-events-auto touch:static touch:bg-none touch:ps-0 touch:opacity-100`;
/** Touch sizing of an action button. */
const ACTION =
  `touch:mx-[calc((2.75rem*var(--cds-rem-scale,1)_-_var(--cds-h-control))/2)] touch:[&:not(:has(~_:is(button,a[href],[role=button],input,[data-cds-part=resolved-mark]),~_*_:is(button,a[href],[role=button],input)))]:me-0 touch:before:absolute touch:before:top-1/2 touch:before:left-1/2 touch:before:size-[calc(2.75rem*var(--cds-rem-scale,1))] touch:before:-translate-x-1/2 touch:before:-translate-y-1/2 touch:before:content-['']`;
/** Touch sizing of the actions toolbar. */
const TOOLBAR =
  `touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:[--cds-h-control:calc(2rem*var(--cds-rem-scale,1))] touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:[--cds-radius:calc(0.5rem*var(--cds-rem-scale,1))] touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:mx-[calc((2.75rem*var(--cds-rem-scale,1)_-_var(--cds-h-control))/2)] touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step]):not(:has(~_:is(button,a[href],[role=button],input,[data-cds-part=resolved-mark]),~_*_:is(button,a[href],[role=button],input)))]:me-0 touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:before:absolute touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:before:top-1/2 touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:before:left-1/2 touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:before:size-[calc(2.75rem*var(--cds-rem-scale,1))] touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:before:-translate-x-1/2 touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:before:-translate-y-1/2 touch:[&_[data-cds=Button][data-cds-icon-only][data-cds-ghost]:not([data-cds-part],[data-size],[data-step])]:before:content-['']`;

const CARD =
  "group/comment-card relative flex flex-col font-sans text-body font-normal text-primary outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-hidden focus-visible:after:shadow-focus";
/** A flat card (a row in a list of threads): tinted while hovered or active. */
const FLAT =
  'bg-[var(--cds-comment-card-row-tint,transparent)] hover:[--cds-comment-card-row-tint:var(--cds-comment-card-hover-tint,var(--cds-alpha-1))] data-[active]:[--cds-comment-card-row-tint:var(--cds-comment-card-hover-tint,var(--cds-alpha-1))] after:inset-px';
/** With a `maxHeight`: the box around the comments' scroll region (it draws the region's focus ring)… */
const SCROLL_BOX =
  'relative flex min-h-0 flex-col mt-[calc(var(--cds-pad-lg)-8px)] mb-pad-xs has-[>:focus-visible]:after:pointer-events-none has-[>:focus-visible]:after:absolute has-[>:focus-visible]:after:inset-0 has-[>:focus-visible]:after:shadow-focus has-[>:focus-visible]:after:outline-hidden';
/** …and the region: the comments scroll in it, the reply box stays under it. */
const SCROLL_REGION =
  'flex min-h-0 flex-col gap-sm overflow-y-auto overscroll-contain px-lg pt-[8px] pb-[max(8px,var(--cds-pad-md))] outline-none scroll-fade-y scroll-fade-hide-top scroll-fade-size-4';
/** What a click on a collapsed card may land on without expanding it (the replies toggle expands it). */
const CARD_CONTROLS =
  'a[href], button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [contenteditable]:not([contenteditable="false"]), [data-cds-part="edit-field"], [data-cds-part="delete-confirm"], [data-cds-part="reply-field"]';

function expandsCard(target: EventTarget, card: HTMLElement): boolean {
  if (!(target instanceof Element) || !card.contains(target)) return false;
  const selection = card.ownerDocument.getSelection();
  if (selection !== null && !selection.isCollapsed && card.contains(selection.anchorNode)) return false;
  const control = target.closest(CARD_CONTROLS);
  return control === null || !card.contains(control) || control.matches('[data-cds-part="replies-toggle"]');
}

export function CommentCard({
  variant = 'raised',
  expanded = true,
  active = false,
  onExpand,
  onClose,
  labelledBy,
  reply,
  maxHeight,
  scrollRegionLabel = 'Comment thread',
  scrollRef,
  scrollProps,
  className,
  children,
}: {
  /** `flat` is a row in a list of threads (no panel of its own). */
  variant?: 'raised' | 'flat';
  expanded?: boolean;
  active?: boolean;
  /** A click or Enter on a collapsed card, away from its controls. */
  onExpand?: () => void;
  onClose?: () => void;
  labelledBy?: string;
  /** The ReplyField, drawn under the comments while the card is expanded. */
  reply?: ReactNode;
  /** The comments go in a region that scrolls past this height (px or a CSS length); the reply box stays under it. */
  maxHeight?: number | string;
  scrollRegionLabel?: string;
  /** That scroll region, and handlers for it. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  scrollProps?: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDownCapture' | 'onWheelCapture' | 'onScroll'>;
  className?: string;
  children: ReactNode;
}) {
  const { dark } = useCdsRoot();
  const raised = variant === 'raised';
  const expandable = Boolean(onExpand) && !expanded;
  return (
    <CardContext.Provider value={{ expanded }}>
      <CloseContext.Provider value={onClose ? { onClose } : null}>
        <article
          data-cds="CommentCard"
          data-variant={variant}
          data-expanded={expanded || undefined}
          data-active={active || undefined}
          aria-labelledby={labelledBy}
          tabIndex={expandable ? 0 : -1}
          className={cn(
            CARD,
            expandable && 'cursor-interactive',
            raised ? cn(panelClass(true), 'transition-shadow duration-fast [--cds-comment-card-bg:var(--cds-surface-2)]') : FLAT,
            className,
          )}
          style={raised ? panelVars(dark) : undefined}
          onClick={expandable ? event => !event.defaultPrevented && expandsCard(event.target, event.currentTarget) && onExpand?.() : undefined}
          onKeyDown={
            expandable
              ? event => {
                  if (event.defaultPrevented || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  if (!event.repeat) onExpand?.();
                }
              : undefined
          }
        >
          {maxHeight === undefined ? (
            <div className="flex min-h-0 flex-col gap-sm p-lg">{children}</div>
          ) : (
            <div className={SCROLL_BOX}>
              <div {...scrollProps} ref={scrollRef} role="group" tabIndex={0} aria-label={scrollRegionLabel} className={SCROLL_REGION} style={{ maxHeight }}>
                {children}
              </div>
            </div>
          )}
          {expanded && reply}
        </article>
      </CloseContext.Provider>
    </CardContext.Provider>
  );
}

export type WorkingState = 'queued' | 'working';

export function Comment({
  authorName,
  agent = false,
  working,
  timestamp,
  actions,
  editor,
  confirm,
  footnote,
  nameId,
  children,
}: {
  authorName: string;
  /** Written by the agent: the robot avatar. */
  agent?: boolean;
  /** The agent has it (working) or it is waiting for one (queued): a dot instead of the avatar. */
  working?: WorkingState;
  timestamp?: ReactNode;
  actions?: ReactNode;
  /** An EditField: replaces the body. */
  editor?: ReactNode;
  /** A DeleteConfirm: drawn under the body. */
  confirm?: ReactNode;
  footnote?: ReactNode;
  nameId?: string;
  children?: ReactNode;
}) {
  const { expanded } = useContext(CardContext);
  const inReplies = useContext(InRepliesContext);
  const close = useContext(CloseContext);
  const id = useId();
  const ids = { name: nameId ?? `${id}-name`, time: `${id}-time`, body: `${id}-body` };
  const placement = expanded && !inReplies ? 'pinned' : 'float';
  const actionsEl = actions ?? (close && !inReplies ? <Actions /> : undefined);
  const avatar = working ? (
    <span className="flex size-[var(--cds-avatar-sm)] shrink-0 items-center justify-center">
      <WorkingDot queued={working === 'queued'} />
    </span>
  ) : (
    <Avatar name={authorName} variant={agent ? 'agent' : 'default'} size="sm" className="shrink-0" />
  );
  const Tag = inReplies ? 'article' : 'div';
  return (
    <Tag
      data-cds-part="comment"
      data-by-agent={agent || undefined}
      data-working={working || undefined}
      aria-labelledby={inReplies ? `${ids.name} ${ids.time}` : undefined}
      tabIndex={inReplies ? -1 : undefined}
      className="group/comment relative flex flex-col gap-xs rounded outline-none focus-visible:shadow-focus focus-visible:outline-hidden touch:isolate"
    >
      <div className={cn('relative flex flex-wrap items-center gap-x-sm text-footnote font-normal touch:z-[1]', !editor && '-mb-[calc(var(--cds-gap-xs)/2)]')}>
        <span aria-hidden="true" className="-me-[calc(var(--cds-gap-sm)-var(--cds-gap-xs))] inline-flex shrink-0">
          {avatar}
        </span>
        <span className="flex min-h-control flex-1 flex-wrap content-center items-baseline gap-x-xs before:h-0 before:w-16 before:basis-full before:content-['']">
          <span className="grid max-w-full grid-cols-[minmax(0,max-content)]">
            <span id={ids.name} className="min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap font-semibold">
              {authorName}
            </span>
          </span>
          {timestamp != null && (
            <span id={ids.time} className="shrink-0 text-caption font-normal whitespace-nowrap text-muted" data-cds-part="timestamp">
              {timestamp}
            </span>
          )}
        </span>
        <PlacementContext.Provider value={placement}>{actionsEl}</PlacementContext.Provider>
      </div>
      {editor ?? (
        <div className="flex flex-col text-body font-normal text-primary" data-cds-part="body" id={ids.body}>
          {children != null && children !== '' && (
            <div className="text-pretty wrap-anywhere [&_code]:break-all [&_pre]:max-w-full [&_pre]:overflow-x-auto">
              <div className="whitespace-pre-wrap">{children}</div>
            </div>
          )}
          {footnote != null && footnote !== false && (
            <span className="text-caption font-normal text-[color:var(--cds-text-stays-secondary,var(--cds-text-muted))]" data-cds-part="footnote">
              {footnote}
            </span>
          )}
        </div>
      )}
      {confirm}
    </Tag>
  );
}

function WorkingDot({ queued }: { queued: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-cds-part="working-dot"
      className="relative block rounded-full p-[calc(0.125rem*var(--cds-rem-scale,1))] motion-safe:animate-[cds-fade-in_var(--cds-dur-base)_var(--cds-ease-out)]"
    >
      {!queued && (
        <span
          style={{ animationDelay: `${-(Date.now() % 2500)}ms` }}
          className="cds-working-dot-halo absolute inset-[calc(0.125rem*var(--cds-rem-scale,1))] rounded-full bg-fill-brand"
        />
      )}
      <span
        className={cn(
          'relative block size-[calc(0.5rem*var(--cds-rem-scale,1))] rounded-full',
          queued
            ? 'border-[length:calc(0.125rem*var(--cds-rem-scale,1))] border-current text-[color:var(--cds-text-stays-secondary,var(--cds-text-muted))]'
            : 'bg-fill-brand forced-colors:border-[length:calc(0.25rem*var(--cds-rem-scale,1))]',
        )}
      />
    </span>
  );
}

/** `placement` overrides the comment's: `pinned` keeps the actions showing (the selected row of a list). */
export function Actions({ placement: forced, children }: { placement?: 'pinned' | 'float'; children?: ReactNode }) {
  const inherited = useContext(PlacementContext);
  const placement = forced ?? inherited;
  const inReplies = useContext(InRepliesContext);
  const close = useContext(CloseContext);
  const closeButton =
    close && !inReplies ? (
      <Button
        variant="ghost"
        iconOnly
        aria-label={close.closeLabel ?? 'Close'}
        icon={<Icon name="X" size="sm" />}
        onClick={close.onClose}
        className={ACTION}
        data-cds-part="close"
      />
    ) : null;
  return (
    <span
      role="toolbar"
      aria-label="Comment actions"
      tabIndex={-1}
      data-cds-part="actions"
      data-placement={placement}
      className={cn('relative ms-auto flex shrink-0 items-center self-stretch', TOOLBAR)}
    >
      {placement === 'float' ? (
        <>
          <span className={cn('flex items-center', FLOAT)}>{children}</span>
          {closeButton}
        </>
      ) : (
        <>
          {children}
          {closeButton}
        </>
      )}
    </span>
  );
}

/**
 * Open menus. Base UI closes a menu on a press outside it by listening on the document, which never hears presses
 * inside the comments layer (shield.ts stops them at the window), so the layer closes them itself.
 */
const openMenus = new Set<() => void>();

/** Closes every open menu; true if one was open. */
export function closeMenus(): boolean {
  const any = openMenus.size > 0;
  for (const close of [...openMenus]) close();
  return any;
}

/** A menu's open state, closed by `closeMenus` (a press elsewhere in the layer or on the page, Escape). */
export function useLayerMenu(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    openMenus.add(close);
    return () => {
      openMenus.delete(close);
    };
  }, [open]);
  return [open, setOpen];
}

export function MoreMenu({
  items,
  label = 'More options',
  disabled = false,
  waitReason,
}: {
  items: readonly MenuItemSpec[];
  label?: string;
  /** The menu does not open. */
  disabled?: boolean;
  /** The menu opens, but every item is disabled for this reason. */
  waitReason?: string;
}) {
  const [open, setOpen] = useLayerMenu();
  if (items.length === 0) return null;
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false} disabled={disabled}>
      <Tooltip content={label} disabled={open}>
        <Menu.Trigger
          render={
            <Button
              variant="ghost"
              iconOnly
              tooltip={false}
              aria-label={label}
              icon={<Icon name="DotsHorizontal" size="sm" />}
              className={ACTION}
              data-cds-part="more"
            />
          }
        />
      </Tooltip>
      <MenuPopup align="end">
        <MenuItems
          items={items.map(item => ({
            ...item,
            ...(waitReason === undefined ? {} : { disabled: true, disabledReason: waitReason }),
            onSelect: () => {
              setOpen(false);
              item.onSelect();
            },
          }))}
        />
      </MenuPopup>
    </Menu.Root>
  );
}

export function ResolveAction({
  resolved = false,
  busy = false,
  disabled = false,
  onResolve,
}: {
  resolved?: boolean;
  busy?: boolean;
  /** Shown but not pressable (another change is on its way). */
  disabled?: boolean;
  onResolve?: () => void;
}) {
  if (resolved) {
    return (
      <Tooltip content="Resolved" side="top">
        <span role="img" aria-label="Resolved" data-cds-part="resolved-mark" className="inline-flex size-control items-center justify-center">
          <Icon name="CheckCircleFilled" size="sm" className="text-accent" />
        </span>
      </Tooltip>
    );
  }
  if (!onResolve) return null;
  return (
    <>
      <Button
        variant="ghost"
        iconOnly
        aria-label="Resolve"
        {...(busy ? { 'aria-busy': true, 'aria-disabled': true } : disabled ? { 'aria-disabled': true } : {})}
        data-cds-part="resolve"
        data-resolving={busy ? 'true' : undefined}
        icon={
          busy ? (
            <span className="cds-resolve-check relative inline-flex">
              <svg viewBox="0 0 16 16" aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
                <rect className="cds-resolve-square" x="0.75" y="0.75" width="14.5" height="14.5" rx="4" />
              </svg>
              <Icon name="Check" size="sm" className="relative" />
            </span>
          ) : (
            <Icon name="Check" size="sm" />
          )
        }
        onClick={busy || disabled ? undefined : onResolve}
        className={ACTION}
      />
      <span role="status" className="sr-only" />
    </>
  );
}

const TEXT_ENTRY = 'textarea, [contenteditable="true"], [role="textbox"]';

/**
 * A part that takes focus while it is shown (an edit box, a delete confirmation): focuses `target` when it appears,
 * and when it goes away with focus inside, gives focus back to what had it, else the comment's ⋯ button, else the card.
 */
function useFocusPart(part: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = part.current;
    if (!node) return;
    const root = node.getRootNode() as Document | ShadowRoot;
    const before = focusedIn(node);
    const restore = before && !node.contains(before) ? before : null;
    const el = target.current;
    if (el) {
      el.focus({ preventScroll: true });
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.setSelectionRange(el.value.length, el.value.length);
    }
    return () => {
      const active = focusedIn(node);
      if (!active || !node.contains(active)) return;
      returnFocus(root, [restore, node.closest('[data-cds-part="comment"]')?.querySelector('[data-cds-part="more"]'), node.closest('[data-cds="CommentCard"]')]);
    };
  }, [part, target]);
}

/** Clicks on the bare parts of a field focus its text box. */
function focusOnBareClick(event: MouseEvent<HTMLElement>, box: HTMLElement | null) {
  const target = event.target as Element;
  if (event.defaultPrevented || target.closest(`${TEXT_ENTRY}, button, input, [role="checkbox"]`)) return;
  event.preventDefault();
  box?.querySelector<HTMLElement>(TEXT_ENTRY)?.focus();
}

export function EditField({
  savedValue,
  onSave,
  onCancel,
  busy = false,
  sendBox,
}: {
  savedValue: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  busy?: boolean;
  sendBox?: SendBoxSpec;
}) {
  const [value, setValue] = useState(savedValue);
  const [initialChecked] = useState(sendBox?.checked);
  const part = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  useFocusPart(part, editor);
  const save = () => {
    if (busy) return;
    const text = value.trim();
    const unchanged = text === savedValue.trim() && sendBox?.checked === initialChecked;
    if (text === '' || unchanged) onCancel();
    else onSave(text);
  };
  return (
    <div ref={part} data-cds-part="edit-field" className="flex flex-col gap-xs" onMouseDown={event => focusOnBareClick(event, box.current)}>
      <div ref={box} className={FIELD_CLASS}>
        <PlainEditor
          ref={editor}
          aria-label="Edit comment"
          value={value}
          onChange={setValue}
          onSubmit={save}
          readOnly={busy}
          className="scroll-thin max-h-[8lh]"
          onKeyDown={event => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              event.stopPropagation();
              if (!busy) onCancel();
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-sm">
        {sendBox && <SendBox box={sendBox} disabled={busy} />}
        <div className="ms-auto flex items-center gap-sm">
          <Button variant="secondary" aria-disabled={busy || undefined} onClick={busy ? undefined : onCancel}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirm({ onDelete, onCancel, busy = false, label }: { onDelete: () => void; onCancel: () => void; busy?: boolean; label?: string }) {
  const id = useId();
  const part = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useFocusPart(part, cancel);
  return (
    <div ref={part} role="group" aria-labelledby={id} data-cds-part="delete-confirm" className="flex flex-col gap-sm border-t pt-sm">
      <span id={id} className="text-body font-normal text-primary">
        {label ?? 'Delete this comment?'}
      </span>
      <div className="flex justify-end gap-sm">
        <Button ref={cancel} variant="secondary" aria-disabled={busy || undefined} onClick={busy ? undefined : onCancel}>
          Cancel
        </Button>
        <Button variant="danger" busy={busy} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function Replies({ children }: { children: ReactNode }) {
  return (
    <InRepliesContext.Provider value={true}>
      <div data-cds-part="replies" className="flex flex-col gap-sm">
        {children}
      </div>
    </InRepliesContext.Provider>
  );
}

export function ReplyField({ children }: { children: ReactNode }) {
  const { expanded } = useContext(CardContext);
  const box = useRef<HTMLDivElement>(null);
  if (!expanded) return null;
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    box.current?.querySelector<HTMLElement>(TEXT_ENTRY)?.focus();
  };
  return (
    <div
      data-cds-part="reply-field"
      className="px-lg pb-lg group-has-[:is([data-cds-part=edit-field],[data-cds-part=delete-confirm])]/comment-card:hidden"
      onMouseDown={onMouseDown}
    >
      <div ref={box} className={FIELD_CLASS} onMouseDown={onMouseDown}>
        <ReplyFieldContext.Provider value={true}>{children}</ReplyFieldContext.Provider>
      </div>
    </div>
  );
}
