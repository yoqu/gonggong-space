/**
 * CommentComposer: the standalone composer (a raised panel) and the reply box
 * inside a card's ReplyField, with the "Send to Agent" checkbox and the @agent
 * mention it puts in front of the text. Same DOM, data attributes and class strings.
 *
 * Added here: `context`, the line above a new comment that says what it is about (the anchor's label).
 */
import { useContext, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { Badge, Button, cn, mergeRefs, panelClass, panelVars, PlainEditor, useCdsRoot } from './cds.tsx';
import { ReplyFieldContext, SendBox, type SendBoxSpec } from './comment-card.tsx';

/** The footer shown. */
const FOOTER_SHOWN = 'grid-rows-[1fr] pt-md opacity-100';
/** The checkbox row tucks into the panel's padding. */
const FOOTER_TUCK = '[--cc-tuck:calc((var(--cds-h-control)_-_var(--cds-checkbox--sm))/2)] -me-[var(--cc-tuck)] -mb-[var(--cc-tuck)]';
const FOOTER_TUCK_REPLY = '-mb-[calc(var(--cc-tuck)_-_var(--cds-pad-md)_+_var(--cds-pad-sm))]';
/** An empty reply box hides its footer until it has focus. */
const FOOTER_IDLE =
  'invisible grid-rows-[0fr] opacity-0 group-focus-within/cc:visible group-focus-within/cc:grid-rows-[1fr] group-focus-within/cc:pt-md group-focus-within/cc:opacity-100';
const HIDDEN = 'invisible opacity-0';
const ENTRY = 'text-body cds-text-entry-floored py-[calc((var(--cds-h-control)_-_1lh)_/_2)]';
const TEXT_ENTRY = 'textarea, [contenteditable="true"], [role="textbox"]';

/**
 * Past these heights the text scrolls inside its box. `--comment-card-room` is the height the card around it may take
 * (set by the popover it opens in), so the box shrinks before the card's own buttons are pushed out of view.
 */
const REPLY_HEIGHT = 'scroll-thin max-h-[min(5lh,var(--comment-card-room,100vh)_-_12rem)]';
const DRAFT_HEIGHT = 'scroll-thin max-h-[min(8lh,max(2lh,var(--comment-card-room,100vh)_-_8rem))]';

export interface CommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter or the send button; `send` is the checkbox. */
  onSubmit: (text: string, how: { send: boolean }) => void;
  /** Escape. */
  onCancel?: () => void;
  placeholder?: string;
  /** Omitted when no agent can take comments: no checkbox, just save. */
  sendBox?: SendBoxSpec;
  busy?: boolean;
  form?: 'reply';
  context?: string;
  label?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function CommentComposer({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder = 'Add your comment',
  sendBox,
  busy = false,
  form,
  context,
  label = 'Comment',
  textareaRef,
}: CommentComposerProps) {
  const { dark } = useCdsRoot();
  const inReplyField = useContext(ReplyFieldContext);
  const reply = inReplyField || form === 'reply';
  const standalone = !inReplyField;
  const mentionable = !reply && sendBox !== undefined;
  const tagged = mentionable && sendBox.checked;
  const hasSendBox = sendBox !== undefined;
  const empty = value.trim() === '';
  const idle = inReplyField && !busy && empty;
  const footerIdle = idle && hasSendBox;

  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const mention = useRef<HTMLSpanElement>(null);
  const editor = useRef<HTMLTextAreaElement | null>(null);

  // The text starts after the @agent tag: --cc-tag-w is its width.
  useLayoutEffect(() => {
    const tag = mention.current;
    const box = grid.current;
    if (!box) return;
    if (!tag) {
      box.style.removeProperty('--cc-tag-w');
      return;
    }
    const measure = () => box.style.setProperty('--cc-tag-w', `${tag.getBoundingClientRect().width}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tag);
    return () => observer.disconnect();
  }, [tagged]);

  const submit = () => {
    if (busy || empty) return;
    onSubmit(value.trim(), { send: Boolean(sendBox?.checked) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;
    if (event.key === 'Escape' && onCancel) {
      if (value !== '') {
        event.preventDefault();
        event.stopPropagation();
      }
      onCancel();
      return;
    }
    const el = event.currentTarget;
    if (event.key === 'Backspace' && !event.repeat && tagged && el.selectionStart === 0 && el.selectionEnd === 0) {
      event.preventDefault();
      sendBox.onCheckedChange(false);
    }
  };

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const box = root.current;
    if (!box?.contains(target)) return;
    const checkbox = target.closest('[role="checkbox"]');
    if (checkbox && checkbox.getAttribute('aria-disabled') !== 'true') {
      event.preventDefault();
      return;
    }
    const control = target.closest(`${TEXT_ENTRY}, button, input, [tabindex="0"]`);
    const wrapsSend = Boolean(control?.querySelector('[data-cds-part="send"]'));
    if (control && !wrapsSend && control !== box && box.contains(control)) return;
    event.preventDefault();
    box.querySelector<HTMLElement>(TEXT_ENTRY)?.focus();
  };

  const sendButton = (
    <Button
      variant="ghost"
      iconOnly
      icon="ArrowUp"
      aria-label="Send"
      shortcut="enter"
      disabled={empty && !busy}
      busy={busy}
      onMouseDown={event => event.preventDefault()}
      onClick={() => {
        submit();
        editor.current?.focus({ preventScroll: true });
      }}
      className="shrink-0"
      data-cds-part="send"
    />
  );

  const entry = (
    <div ref={grid} className={cn('grid min-w-0', mentionable && 'text-body font-normal')}>
      {tagged && (
        <span ref={mention} aria-hidden data-cds-part="mention" className="flex h-[1lh] items-center justify-self-start [grid-area:1/1]">
          <Badge>@agent</Badge>
        </span>
      )}
      <div className="min-w-0 [grid-area:1/1]">
        <PlainEditor
          ref={mergeRefs(editor, textareaRef)}
          value={value}
          onChange={onChange}
          onSubmit={submit}
          onKeyDown={onKeyDown}
          placeholder={tagged ? undefined : placeholder}
          aria-label={label}
          readOnly={busy}
          aria-disabled={busy || undefined}
          className={cn(
            'min-h-[1lh] placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap',
            inReplyField ? REPLY_HEIGHT : DRAFT_HEIGHT,
            tagged && 'indent-[calc(var(--cc-tag-w,0px)+var(--cds-gap-xs))]',
          )}
        />
      </div>
    </div>
  );

  const restingSend =
    inReplyField && !hasSendBox ? (
      <span
        data-cds-part="send-rest"
        data-idle={idle || undefined}
        className={cn('flex shrink-0 transition-[opacity,visibility] duration-fast ease-out motion-reduce:transition-none', idle && HIDDEN)}
      >
        {sendButton}
      </span>
    ) : (
      sendButton
    );

  const body = (
    <>
      {standalone && context && <div className="mb-md truncate text-muted">{context}</div>}
      <div
        className={cn(
          hasSendBox ? 'flex min-h-control min-w-0 flex-col justify-center' : 'flex min-w-0 items-end gap-sm',
          !hasSendBox && inReplyField && '-me-[calc(var(--cds-pad-md)-var(--cds-pad-sm))]',
        )}
      >
        <div className={cn('min-w-0', ENTRY, !hasSendBox && 'flex-1 self-center')}>{entry}</div>
        {hasSendBox ? null : restingSend}
      </div>
      {hasSendBox && (
        <div
          data-cds-part="footer"
          data-idle={footerIdle || undefined}
          className={cn(
            'grid transition-[grid-template-rows,padding,opacity,visibility] duration-fast ease-out motion-reduce:transition-none',
            footerIdle ? FOOTER_IDLE : FOOTER_SHOWN,
          )}
        >
          <div
            className={cn(
              'flex min-h-0 min-w-0 items-center justify-between gap-sm',
              FOOTER_TUCK,
              inReplyField && FOOTER_TUCK_REPLY,
              footerIdle && 'overflow-hidden group-focus-within/cc:overflow-visible',
            )}
          >
            <div className="flex min-w-0">
              <SendBox box={sendBox} disabled={busy} />
            </div>
            {sendButton}
          </div>
        </div>
      )}
    </>
  );

  return standalone ? (
    <div
      ref={root}
      data-cds="CommentComposer"
      data-form={reply ? 'reply' : undefined}
      onMouseDown={onMouseDown}
      className={cn(panelClass(true), 'group/cc relative flex min-w-0 flex-col p-lg font-sans text-body font-normal text-primary')}
      style={panelVars(dark)}
    >
      <div className="peer contents">{body}</div>
      <div aria-hidden data-draft-ring="" className="pointer-events-none absolute inset-px rounded-[inherit] peer-focus-within:shadow-focus" />
    </div>
  ) : (
    <div ref={root} data-cds="CommentComposer" data-form={reply ? 'reply' : undefined} onMouseDown={onMouseDown} className="group/cc flex min-w-0 flex-col">
      {body}
    </div>
  );
}
