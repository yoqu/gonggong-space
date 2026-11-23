/**
 * fixed under the bar the comments button is in, at the right edge; every thread newest first, open ones unless
 * "Show resolved" is ticked in its filter menu; "Send all to {agent}" for whoever may send; a click on a row shows the
 * thread where it is (comment mode on, its anchor in view, its card open). Each row is a flat comment card whose
 * Resolve and ⋯ menu (Reopen, Delete thread) show while it is hovered or current.
 *
 * What a type supplies is only its threads and anchors (the controller); the panel is the same everywhere.
 */

import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useId, useState, type ReactNode } from 'react';
import type { CommentThread } from '@open-artifact/runtime';
import { Button, CheckboxMark, cn, Icon, MENU_ITEM, Menu, MenuPopup, panelClass, panelVars, RobotGlyph, Tooltip, useCdsRoot, type MenuItemSpec } from './cds/cds.tsx';
import { Actions, Comment, CommentCard, DeleteConfirm, MoreMenu, ResolveAction, useLayerMenu } from './cds/comment-card.tsx';
import { CommentsLayer } from './cds/layer.tsx';
import { commentMarkdown } from './cds/markdown.tsx';
import { commentAgo } from './cds/time.ts';
import { WAIT_FOR_STATUS_CHANGE, type CommentsController } from './comments.ts';
import type { AgentBadge } from './CommentViews.tsx';

/** The panel: 300px, 12px from the right edge and from the bar above it. */
const PANEL_WIDTH = 300;
const PANEL_GAP = 12;
/** The room the open panel takes at the right edge (pins' edge tabs keep clear of it). */
export const ALL_COMMENTS_RIGHT = PANEL_WIDTH + PANEL_GAP * 2;

export interface AllCommentsProps<A> {
  comments: CommentsController<A>;
  agent: AgentBadge;
  /** Where the panel starts, px from the window's top (default 12: under a Shell's bar, the frame's top). */
  top?: number;
  /** What the empty panel says to someone who can comment. */
  hint?: string;
}

/** The "All comments" panel, while the comments store says it is open. */
export function AllComments<A>({ comments, agent, top = PANEL_GAP, hint }: AllCommentsProps<A>): ReactNode {
  const open = comments.store((s) => s.listOpen && s.available);
  if (!open) return null;
  return (
    <CommentsLayer mark="data-comments-panel-layer">
      <Panel comments={comments} agent={agent} top={top} hint={hint} />
    </CommentsLayer>
  );
}

const firstAt = (thread: CommentThread): string => thread.messages[0]?.at ?? '';

function Panel<A>({ comments, agent, top, hint }: Required<Omit<AllCommentsProps<A>, 'hint'>> & { hint?: string }): ReactNode {
  const { dark } = useCdsRoot();
  const threads = comments.store((s) => s.threads);
  const showResolved = comments.store((s) => s.showResolved);
  const on = comments.store((s) => s.on);
  const active = comments.store((s) => s.active);
  const close = (): void => comments.store.getState().setListOpen(false);
  const all = threads.filter((t) => t.messages.length > 0);
  const shown = all.filter((t) => showResolved || t.status === 'open').sort((a, b) => firstAt(b).localeCompare(firstAt(a)));
  const resolved = all.filter((t) => t.status === 'resolved').length;

  return (
    <section
      aria-label="All comments"
      data-comments-panel=""
      className={cn(panelClass(true), 'fixed flex flex-col text-body text-primary')}
      style={{
        top,
        right: PANEL_GAP,
        width: PANEL_WIDTH,
        maxWidth: `calc(100vw - ${PANEL_GAP * 2}px)`,
        maxHeight: `calc(100dvh - ${top + PANEL_GAP}px)`,
        zIndex: 40,
        // Over a host that lets the pointer through (a frame's comments layer), the panel still takes it.
        pointerEvents: 'auto',
        ...panelVars(dark),
      }}
      onKeyDown={(event) => {
        // A menu's Escape (its popup is a portal, so React bubbles its keys here) closes only the menu.
        const inMenu = event.target instanceof Element && event.target.closest('[data-cds=Menu]');
        if (event.key === 'Escape' && !event.defaultPrevented && !inMenu) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-xs" style={{ padding: '10px 10px 6px 16px' }}>
        <span className="min-w-0 flex-1 truncate font-medium">All comments</span>
        <FilterMenu showResolved={showResolved} onShowResolved={(next) => comments.store.getState().setShowResolved(next)} />
        <Button variant="ghost" iconOnly aria-label="Close" icon={<Icon name="X" size="sm" />} onClick={close} />
      </div>
      <SendAll comments={comments} agent={agent} threads={all} />
      <div className="flex min-h-0 flex-col gap-xs overflow-y-auto [--cds-comment-card-bg:var(--cds-surface-2)]" style={{ padding: '0 12px 12px' }}>
        {all.length === 0 ? (
          <div data-comments-empty="" className="flex flex-1 flex-col items-center justify-center gap-xs px-lg text-center" style={{ paddingBlock: 'var(--cds-pad-xl)' }}>
            <span className="text-body font-medium text-secondary">No comments yet</span>
            <span className="text-caption text-muted">
              {comments.canComment() ? (hint ?? 'Press the comment button, then click anywhere on the artifact to add one.') : 'Only people with comment access can add one.'}
            </span>
          </div>
        ) : shown.length === 0 ? (
          <span data-comments-filtered-empty="" className="px-lg text-center text-caption text-muted" style={{ paddingBlock: 'var(--cds-pad-xl)' }}>
            No open comments.
            {resolved > 0 ? (
              <>
                {' '}
                <button type="button" className="cds-text-link cds-text-link-underline inline text-inherit" onClick={() => comments.store.getState().setShowResolved(true)}>
                  {`Show ${resolved} resolved`}
                </button>
              </>
            ) : null}
          </span>
        ) : null}
        {shown.map((thread) => (
          // The current row is the thread whose card is showing (out of comment mode no card shows).
          <PanelThread key={thread.id} comments={comments} agent={agent} thread={thread} current={on && active === thread.id} />
        ))}
      </div>
    </section>
  );
}

function FilterGlyph(): ReactNode {
  return (
    <svg data-cds="Icon" aria-hidden width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" style={{ fontSize: 'calc(1rem * var(--cds-rem-scale,1))' }}>
      <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
    </svg>
  );
}

function FilterMenu({ showResolved, onShowResolved }: { showResolved: boolean; onShowResolved(on: boolean): void }): ReactNode {
  const [open, setOpen] = useLayerMenu();
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip content="Filter" disabled={open}>
        <Menu.Trigger render={<Button variant="ghost" iconOnly tooltip={false} aria-label="Filter" icon={<FilterGlyph />} />} />
      </Tooltip>
      <MenuPopup align="end">
        <BaseMenu.CheckboxItem
          checked={showResolved}
          onCheckedChange={onShowResolved}
          closeOnClick={false}
          className={cn(MENU_ITEM, 'group/cb text-primary data-[highlighted]:bg-fill-ghost-hover')}
        >
          <CheckboxMark />
          <span className="min-w-0 flex-1 truncate">Show resolved</span>
        </BaseMenu.CheckboxItem>
      </MenuPopup>
    </Menu.Root>
  );
}

/**
 * "Send all to {agent}": every open thread with something from a person the agent hasn't been handed.
 * Shown to whoever may send once an open thread has a person's comment; right after a send, with nothing new since, it
 * says so instead of sending again.
 */
function SendAll<A>({ comments, agent, threads }: { comments: CommentsController<A>; agent: AgentBadge; threads: readonly CommentThread[] }): ReactNode {
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const open = threads.filter((t) => t.status === 'open' && t.messages.some((m) => m.author.kind === 'person'));
  if (!comments.canSendToAgent() || !agent.available || open.length === 0) return null;
  const nothingNew = !open.some((t) => comments.canSendThread(t));
  const reason = nothingNew ? (justSent ? `These comments were just sent to ${agent.name}.` : `${agent.name} has every comment.`) : undefined;
  return (
    <div className="flex shrink-0 flex-col items-end gap-sm" style={{ padding: '0 12px 8px' }}>
      <Tooltip content={reason} side="bottom">
        <Button
          data-comments-send-all=""
          data-size="sm"
          variant="secondary"
          busy={sending}
          aria-disabled={reason !== undefined || sending || undefined}
          className="aria-disabled:opacity-disabled"
          onClick={() => {
            if (reason !== undefined || sending) return;
            setSending(true);
            void comments
              .sendAllToAgent()
              .then(() => setJustSent(true))
              .finally(() => setSending(false));
          }}
        >
          {`Send all to ${agent.name}`}
        </Button>
      </Tooltip>
    </div>
  );
}

/**
 * A thread in the panel: a flat comment card. Its resolve button and ⋯ menu (Reopen, Delete thread) show while the row
 * is hovered or current; the delete confirmation opens in the row. A click elsewhere on it, the replies line included,
 * shows the thread where it is.
 */
function PanelThread<A>({ comments, agent, thread, current }: { comments: CommentsController<A>; agent: AgentBadge; thread: CommentThread; current: boolean }): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const change = comments.store((s) => s.statusChange);
  const nameId = useId();
  const first = thread.messages[0]!;
  const replies = thread.messages.length - 1;
  const resolved = thread.status === 'resolved';
  const commenting = comments.canComment();
  const author = first.author.kind === 'agent' ? first.author.name || agent.name : first.author.name || 'Someone';
  const items: MenuItemSpec[] = [
    ...(resolved && commenting ? [{ label: 'Reopen', icon: 'Comment' as const, onSelect: () => void comments.resolve(thread.id, false) }] : []),
    ...(comments.canRemove() ? [{ label: 'Delete thread', icon: 'Trash' as const, variant: 'danger' as const, onSelect: () => setConfirming(true) }] : []),
  ];

  return (
    <CommentCard variant="flat" expanded={false} active={current} labelledBy={nameId} onExpand={() => comments.show(thread)} className="rounded">
      <Comment
        nameId={nameId}
        authorName={author}
        agent={first.author.kind === 'agent'}
        timestamp={
          <>
            {commentAgo(first.at)}
            {resolved && ' · Resolved'}
            {thread.agent ? (
              <span
                role="img"
                aria-label={`Sent to ${agent.name}`}
                className="inline-flex"
                style={{ width: 18, height: 18, marginInlineStart: 4, verticalAlign: 'middle', color: 'var(--cds-fill-brand)' }}
              >
                <RobotGlyph />
              </span>
            ) : null}
          </>
        }
        confirm={
          confirming ? (
            <DeleteConfirm
              busy={deleting}
              onCancel={() => setConfirming(false)}
              onDelete={() => {
                setDeleting(true);
                void comments.remove(thread.id).finally(() => setDeleting(false));
              }}
            />
          ) : undefined
        }
        actions={
          <Actions placement={current ? 'pinned' : undefined}>
            {commenting ? (
              <ResolveAction resolved={resolved} disabled={change !== null} onResolve={() => void comments.resolve(thread.id, true)} />
            ) : null}
            <MoreMenu
              items={items}
              disabled={change !== null && change.id !== thread.id}
              waitReason={change?.id === thread.id ? WAIT_FOR_STATUS_CHANGE : undefined}
            />
          </Actions>
        }
      >
        <span className="line-clamp-3">{commentMarkdown(first.text, { flat: true })}</span>
      </Comment>
      {replies > 0 && !confirming ? (
        <button type="button" data-cds-part="replies-toggle" className="self-start text-body font-normal text-accent hover:underline">
          {replies === 1 ? '1 reply' : `${replies} replies`}
        </button>
      ) : null}
    </CommentCard>
  );
}
