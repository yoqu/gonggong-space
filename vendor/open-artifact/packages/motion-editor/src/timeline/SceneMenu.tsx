import { Fragment, useState, type ReactElement, type ReactNode } from 'react';
import { Ellipsis, MessageSquarePlus, Trash2 } from 'lucide-react';
import { ConfirmDialog, Menu, MenuItem, MenuSeparator } from '@open-artifact/ui';
import { askDeleteScene } from '../agent/requests.ts';
import { commentOnStretch, filmComments } from '../comments/comments.ts';
import { useWorking } from '../stores/working.ts';
import { useSceneMenu, type SceneMenuContext } from './scene-menu.ts';
import type { PartSpan } from './timeline-math.ts';
import * as words from './words.ts';

type SceneDialog = (close: () => void) => ReactNode;

/** A scene card's menu: ask for a change (a comment over the scene), the items other parts add, and the request to delete it. */
export function SceneMenu({ span, count }: { span: PartSpan; count: number }): ReactElement | null {
  const canAsk = useWorking((s) => s.canAsk);
  const agent = useWorking((s) => s.name);
  const writable = useWorking((s) => s.readOnlyReason === null);
  const added = useSceneMenu((s) => s.items);
  const [confirming, setConfirming] = useState(false);
  const [dialog, setDialog] = useState<SceneDialog | null>(null);
  const canComment = filmComments.canComment();
  const items = writable ? added : added.filter((item) => item.writes !== true);
  const canDelete = canAsk && count > 1;
  if (!canDelete && !canComment && items.length === 0) return null;
  const number = span.index + 1;
  const context: SceneMenuContext = { span, showDialog: (next) => setDialog(() => next) };
  return (
    <>
      <Menu
        side="top"
        align="start"
        trigger={
          <button
            type="button"
            aria-label={words.sceneOptions(span.label, number)}
            className="flex size-5 items-center justify-center rounded text-chrome-muted hover:bg-chrome-hover hover:text-chrome-fg"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Ellipsis className="size-3.5" aria-hidden="true" />
          </button>
        }
      >
        {canComment ? (
          <MenuItem icon={<MessageSquarePlus className="size-4" />} onSelect={() => commentOnStretch(span.start, span.start + span.dur)}>
            {words.ASK_FOR_CHANGE}
          </MenuItem>
        ) : null}
        {items.length > 0 && canComment ? <MenuSeparator /> : null}
        {items.map((item) => (
          <Fragment key={item.id}>{item.render(context)}</Fragment>
        ))}
        {canDelete && (canComment || items.length > 0) ? <MenuSeparator /> : null}
        {canDelete ? (
          <MenuItem danger icon={<Trash2 className="size-4" />} onSelect={() => setConfirming(true)}>
            {words.DELETE_SCENE}
          </MenuItem>
        ) : null}
      </Menu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={words.deleteSceneTitle(span.label)}
        description={words.deleteSceneDescription(agent)}
        confirmLabel={words.DELETE}
        danger
        onConfirm={() => void askDeleteScene(number, count)}
      />
      {dialog?.(() => setDialog(null))}
    </>
  );
}
