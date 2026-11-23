/**
 * The board's context menu. {@link BoardContextMenu} wraps the surface and
 * opens the menu on a right-click or a touch long-press; the keyboard
 * (Menu key, ⇧F10) and the selection bar's More button open it through the
 * same store (`useContextMenu`).
 *
 * - On items (also the selection bar's More actions): open link, rename a
 *   section, table rows and columns and heat maps, lock; cut, copy, paste, duplicate;
 *   layer order, group, ungroup, tidy up; delete; ask the agent (when one
 *   is connected).
 * - On the empty board: paste, select all, fit the board, add a note here,
 *   ask the agent.
 *
 * A command that cannot run stays in the menu, disabled, with the reason
 * as its tooltip.
 */

import { Menu as BaseMenu } from '@base-ui/react/menu';
import {
  arrowNeedsEndsMessage,
  expandSelectionToGroups,
  isElementLocked,
  planGroupSelection,
  planUngroupSelection,
  type BoardContent,
  type ElementId,
  type TableAxis,
} from '@open-artifact/whiteboard-core';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { surfaceRef } from '../canvas/BoardSurface.tsx';
import { linkDisplayUrl, openBoardLink } from '../elements/links.ts';
import { screenToBoard, type Point } from '../lib/camera.ts';
import { TABLE_HEAT_LABELS, takesRowHeat } from '../lib/table-heat.ts';
import { isApplePlatform, modKey } from '../lib/tools.ts';
import { useContextMenu, type MenuCell, type MenuKind } from '../selection/menu-store.ts';
import {
  TIDY_REFUSAL,
  arrangedContent,
  arrangeSelection,
  boardElements,
  canEditBoard,
  canTidy,
  deleteSelection,
  duplicateSelectionNow,
  groupSelection,
  groupingRefusal,
  onlyArrowsMissingEnds,
  runTableCellCommand,
  tableCellRefusals,
  tidySelection,
  toggleLockSelection,
  ungroupSelection,
  type TableCellCommand,
} from '../services/actions.ts';
import { useAgent } from '../services/agent.ts';
import { EMPTY_BOARD_MESSAGE, LOCKED_MESSAGE, READ_ONLY_MESSAGE } from '../services/announce.ts';
import { INTERNAL_PASTE_ONLY_MESSAGE, canPasteFromMenu, copySelectionCommand, pasteFromMenu } from '../services/clipboard.ts';
import { selectEverything, isTypingTarget } from '../services/keyboard.ts';
import { setTableLineHeat, toggleTableLineHeat } from '../services/table-edits.ts';
import { contentBounds, fitBoard, viewCenter } from '../services/navigation.ts';
import { useAsk } from '../state/ask.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { usePreferences } from '../state/preferences.ts';
import { useSelection } from '../state/selection.ts';
import { useTool } from '../state/tool.ts';
import { elementIdAt } from '../tools/gesture.ts';
import { createNoteAt, placeElement } from '../tools/place.ts';
import { TOUCH_LONG_PRESS_MS, movedPastTouchSlop } from '../tools/touch.ts';
import { ChromeMenuItem, ChromeMenuSeparator, POPUP } from './chrome.tsx';
import { useCoarsePointer } from './hooks.ts';
import { selectionLinks } from './selection-links.ts';
import { severalLinksMessage } from '../lib/link-card.ts';

/* ------------------------------------------------------------------------ */
/* Opening                                                                  */
/* ------------------------------------------------------------------------ */

/** Why table row and column commands are off when the table is gone. */
const TABLE_GONE_MESSAGE = 'That table is no longer on the board';

/** The table cell under a DOM node (table views mark cells with `data-wb-row` and `data-wb-col`). */
function cellAt(node: Element | null): { row: string; col: string } | undefined {
  const cell = node?.closest<HTMLElement>('[data-wb-row][data-wb-col]');
  const row = cell?.dataset.wbRow;
  const col = cell?.dataset.wbCol;
  return row !== undefined && col !== undefined ? { row, col } : undefined;
}

/** True when a board point lies within the selection's bounds. */
function insideSelection(point: Point): boolean {
  const ids = new Set(useSelection.getState().ids);
  const bounds = contentBounds(boardElements().filter((element) => ids.has(element.id)));
  return bounds !== undefined && point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h;
}

/**
 * Opens the menu for a press at client coordinates on `target`: an item
 * there is selected first (with its group), a press on empty board outside
 * the selection clears it.
 */
export function openContextMenuAt(client: Point, target: Element | null): void {
  const rect = surfaceRef.current?.getBoundingClientRect();
  const board = rect ? screenToBoard(useCamera.getState().camera, { x: client.x - rect.left, y: client.y - rect.top }) : null;
  const selection = useSelection.getState();
  const byId = useBoard.getState().byId;
  const id = elementIdAt(target);
  let kind: MenuKind = 'board';
  let cell: MenuCell | null = null;
  if (id !== null && byId.has(id)) {
    if (!selection.ids.includes(id)) selection.select([...expandSelectionToGroups(boardElements(), new Set([id]), selection.ids)]);
    kind = 'items';
    const found = byId.get(id)?.type === 'table' ? cellAt(target) : undefined;
    if (found) cell = { table: id, ...found };
  } else if (selection.ids.length > 0 && board !== null && insideSelection(board)) {
    kind = 'items';
  } else if (selection.ids.length > 0) {
    selection.clear();
  }
  useContextMenu.getState().show({ at: client, kind, board, cell });
}

/** Listens for right-clicks and long-presses under `root`; returns a function that stops. */
function listenForMenu(root: HTMLElement): () => void {
  /** A touch press that may become a long press; `held` once it lasted long enough. */
  let press: { id: number; at: Point; target: Element | null; held: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  let longPressAt = 0;
  const cancel = (): void => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  const ownsTarget = (target: EventTarget | null): target is Element =>
    target instanceof Element && target.closest('[data-wb-chrome]') === null && !isTypingTarget(target);

  const onContextMenu = (event: MouseEvent): void => {
    if (!ownsTarget(event.target)) return;
    event.preventDefault();
    // A touch long-press opens it when the finger lifts (touch browsers also send `contextmenu`).
    if (press !== null || performance.now() - longPressAt < 1000) return;
    openContextMenuAt({ x: event.clientX, y: event.clientY }, event.target);
  };
  const onDown = (event: PointerEvent): void => {
    cancel();
    if (event.pointerType !== 'touch' || !event.isPrimary || !ownsTarget(event.target)) return;
    if (useTool.getState().tool !== 'select' || useTool.getState().commentMode) return;
    const current = {
      id: event.pointerId,
      at: { x: event.clientX, y: event.clientY },
      target: event.target,
      held: false,
      timer: setTimeout(() => {
        current.held = true;
      }, TOUCH_LONG_PRESS_MS),
    };
    press = current;
  };
  const onMove = (event: PointerEvent): void => {
    // Moving after the hold drags the picked-up item instead (see `tools/touch.ts`).
    if (press && event.pointerId === press.id && movedPastTouchSlop(press.at, { x: event.clientX, y: event.clientY })) cancel();
  };
  const onEnd = (event: PointerEvent): void => {
    if (!press || event.pointerId !== press.id) return;
    const { held, at, target } = press;
    cancel();
    if (!held || event.type !== 'pointerup') return;
    longPressAt = performance.now();
    openContextMenuAt(at, target);
  };

  root.addEventListener('contextmenu', onContextMenu, { capture: true });
  root.addEventListener('pointerdown', onDown, { capture: true });
  root.addEventListener('pointermove', onMove, { capture: true });
  root.addEventListener('pointerup', onEnd, { capture: true });
  root.addEventListener('pointercancel', onEnd, { capture: true });
  return () => {
    cancel();
    root.removeEventListener('contextmenu', onContextMenu, { capture: true });
    root.removeEventListener('pointerdown', onDown, { capture: true });
    root.removeEventListener('pointermove', onMove, { capture: true });
    root.removeEventListener('pointerup', onEnd, { capture: true });
    root.removeEventListener('pointercancel', onEnd, { capture: true });
  };
}

/* ------------------------------------------------------------------------ */
/* Commands                                                                 */
/* ------------------------------------------------------------------------ */

/** Commands of the item menu. */
type ItemCommand =
  | 'open-link'
  | 'rename'
  | 'lock'
  | TableCellCommand
  | TableHeatCommand
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'front'
  | 'back'
  | 'group'
  | 'ungroup'
  | 'tidy'
  | 'delete'
  | 'ask';

/** Heat map commands on a table cell: turn its column's or row's heat map on or off, or remove it. */
type TableHeatCommand = 'heat-cols' | 'heat-rows' | 'heat-cols-off' | 'heat-rows-off';

const TABLE_HEAT_COMMANDS: readonly TableHeatCommand[] = ['heat-cols', 'heat-rows', 'heat-cols-off', 'heat-rows-off'];

/** The axis a heat map command works on. */
function heatCommandAxis(command: TableHeatCommand): TableAxis {
  return command.startsWith('heat-rows') ? 'rows' : 'cols';
}

/** Commands of the board menu. */
type BoardCommand = 'paste' | 'select-all' | 'fit' | 'add-note' | 'ask';

/** Why the agent cannot be asked now (absent when it can). */
function askRefusal(editable: boolean, agentAvailable: boolean): string | undefined {
  if (!editable) return READ_ONLY_MESSAGE;
  return agentAvailable ? undefined : 'No agent is connected to this board.';
}

/** Why each item command cannot run on the selection (absent when it can). */
function itemRefusals(
  content: BoardContent,
  ids: ReadonlySet<ElementId>,
  cell: MenuCell | null,
  facts: { editable: boolean; agentAvailable: boolean; canPaste: boolean },
): Partial<Record<ItemCommand, string>> {
  const refusals: Partial<Record<ItemCommand, string>> = {};
  const elements = content.elements;
  const selected = elements.filter((element) => ids.has(element.id));
  const allLocked = selected.length > 0 && selected.every(isElementLocked);
  const arrowsOnly = onlyArrowsMissingEnds(elements, ids);
  if (arrowsOnly) {
    refusals.copy = arrowNeedsEndsMessage('copy');
  }
  const ask = askRefusal(facts.editable, facts.agentAvailable);
  if (ask) refusals.ask = ask;
  if (!facts.editable) {
    for (const command of ['rename', 'lock', 'cut', 'paste', 'duplicate', 'front', 'back', 'group', 'ungroup', 'tidy', 'delete'] as const) refusals[command] = READ_ONLY_MESSAGE;
    for (const command of ['row-above', 'row-below', 'row-delete', 'col-left', 'col-right', 'col-delete', ...TABLE_HEAT_COMMANDS] as const) refusals[command] = READ_ONLY_MESSAGE;
    return refusals;
  }
  if (arrowsOnly) {
    refusals.cut = arrowNeedsEndsMessage('cut');
    refusals.duplicate = arrowNeedsEndsMessage('duplicate');
  }
  if (!facts.canPaste) refusals.paste = INTERNAL_PASTE_ONLY_MESSAGE;
  if (allLocked) {
    for (const command of ['rename', 'cut', 'front', 'back', 'group', 'ungroup', 'tidy', 'delete'] as const) refusals[command] ??= LOCKED_MESSAGE;
  } else {
    if (arrangedContent(content, ids, 'front') === content) refusals.front = 'Already at the front';
    if (arrangedContent(content, ids, 'back') === content) refusals.back = 'Already at the back';
    const group = groupingRefusal(planGroupSelection(elements, ids));
    if (group) refusals.group = group;
    const ungroup = groupingRefusal(planUngroupSelection(elements, ids));
    if (ungroup) refusals.ungroup = ungroup;
    if (!canTidy(elements, ids)) refusals.tidy = TIDY_REFUSAL;
  }
  if (cell) {
    const table = elements.find((element) => element.id === cell.table);
    if (table?.type === 'table') {
      const cellRefusals = isElementLocked(table) ? undefined : tableCellRefusals(table, cell);
      for (const command of ['row-above', 'row-below', 'row-delete', 'col-left', 'col-right', 'col-delete'] as const) {
        const reason = cellRefusals ? cellRefusals[command] : LOCKED_MESSAGE;
        if (reason) refusals[command] = reason;
      }
      if (isElementLocked(table)) for (const command of TABLE_HEAT_COMMANDS) refusals[command] = LOCKED_MESSAGE;
    } else {
      // The table went away under the open menu (a peer deleted it).
      for (const command of ['row-above', 'row-below', 'row-delete', 'col-left', 'col-right', 'col-delete', ...TABLE_HEAT_COMMANDS] as const) refusals[command] = TABLE_GONE_MESSAGE;
    }
  }
  return refusals;
}

/** Runs an item command. */
function runItemCommand(command: ItemCommand, cell: MenuCell | null, board: Point | null, link: string | undefined): void {
  switch (command) {
    case 'open-link':
      if (link !== undefined) openBoardLink(link);
      return;
    case 'rename': {
      const [id] = useSelection.getState().ids;
      if (id !== undefined) requestAnimationFrame(() => useSelection.getState().edit({ kind: 'element', id }));
      return;
    }
    case 'lock':
      toggleLockSelection();
      return;
    case 'row-above':
    case 'row-below':
    case 'row-delete':
    case 'col-left':
    case 'col-right':
    case 'col-delete':
      if (cell) runTableCellCommand(cell.table, cell, command);
      return;
    case 'heat-cols':
    case 'heat-rows':
    case 'heat-cols-off':
    case 'heat-rows-off': {
      if (!cell) return;
      const axis = heatCommandAxis(command);
      const line = axis === 'rows' ? cell.row : cell.col;
      if (command.endsWith('-off')) setTableLineHeat(cell.table, axis, line, '');
      else toggleTableLineHeat(cell.table, axis, line);
      return;
    }
    case 'cut':
    case 'copy':
      copySelectionCommand(command);
      return;
    case 'paste':
      pasteFromMenu(board);
      return;
    case 'duplicate':
      duplicateSelectionNow();
      return;
    case 'front':
    case 'back':
      arrangeSelection(command);
      return;
    case 'group':
      groupSelection();
      return;
    case 'ungroup':
      ungroupSelection();
      return;
    case 'tidy':
      tidySelection();
      return;
    case 'delete':
      deleteSelection();
      return;
    case 'ask':
      useAsk.getState().show({ kind: 'selection', ids: [...useSelection.getState().ids] });
      return;
  }
}

/** Runs a board command. */
function runBoardCommand(command: BoardCommand, board: Point | null): void {
  switch (command) {
    case 'paste':
      pasteFromMenu(board);
      return;
    case 'select-all':
      selectEverything();
      return;
    case 'fit':
      fitBoard();
      return;
    case 'add-note':
      placeElement(createNoteAt(board ?? viewCenter()), { label: 'Add note' });
      return;
    case 'ask':
      useAsk.getState().show();
      return;
  }
}

/* ------------------------------------------------------------------------ */
/* Views                                                                    */
/* ------------------------------------------------------------------------ */

/** A key label with the platform's modifiers (`⇧⌘G` on Apple platforms, `Ctrl+Shift+G` elsewhere). */
function keyLabel(key: string, options: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): string {
  if (isApplePlatform()) return (options.alt ? '⌥' : '') + (options.shift ? '⇧' : '') + (options.mod ? '⌘' : '') + key;
  return (options.mod ? 'Ctrl+' : '') + (options.alt ? 'Alt+' : '') + (options.shift ? 'Shift+' : '') + key;
}

/** One menu row for a command. */
function CommandItem({
  label,
  refusal,
  shortcut,
  description,
  danger,
  onSelect,
}: {
  label: string;
  refusal: string | undefined;
  shortcut?: string;
  /** A second line under the label (a link's address). */
  description?: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <ChromeMenuItem
      onSelect={onSelect}
      {...(description !== undefined ? { description } : {})}
      disabled={refusal !== undefined}
      {...(refusal !== undefined ? { title: refusal } : {})}
      {...(shortcut !== undefined ? { shortcut } : {})}
      {...(danger ? { danger } : {})}
    >
      {label}
    </ChromeMenuItem>
  );
}

/** The rows of the item menu. */
function ItemMenuItems({ cell, board }: { cell: MenuCell | null; board: Point | null }) {
  const ids = useSelection((state) => state.ids);
  const content = useBoard((state) => state.board.content);
  const agentAvailable = useAgent((state) => state.available);
  const keysOn = usePreferences((state) => state.letterKeys);
  const coarse = useCoarsePointer();
  const editable = canEditBoard();
  const idSet = useMemo(() => new Set(ids), [ids]);
  const selected = useMemo(() => content.elements.filter((element) => idSet.has(element.id)), [content, idSet]);
  const refusals = useMemo(
    () => itemRefusals(content, idSet, cell, { editable, agentAvailable, canPaste: canPasteFromMenu() }),
    [content, idSet, cell, editable, agentAvailable],
  );
  const links = selectionLinks(selected);
  const [link] = links;
  const [only] = selected;
  const section = selected.length === 1 && only?.type === 'container' ? only : undefined;
  const locked = selected.length > 0 && selected.every(isElementLocked);
  const run = (command: ItemCommand) => (): void => runItemCommand(command, cell, board, link);
  const item = (command: ItemCommand, label: string, shortcut?: string, danger?: boolean) => (
    <CommandItem
      key={command}
      label={label}
      refusal={refusals[command]}
      onSelect={run(command)}
      {...(shortcut !== undefined ? { shortcut } : {})}
      {...(danger ? { danger } : {})}
    />
  );
  const lockItem = item('lock', locked ? 'Unlock' : 'Lock', keyLabel('L', { mod: true, shift: true }));
  const table = cell ? content.elements.find((element) => element.id === cell.table) : undefined;
  const heatItems: ReactNode[] = [];
  if (cell && table?.type === 'table') {
    const axes: readonly TableAxis[] = takesRowHeat(table, cell.row) ? ['cols', 'rows'] : ['cols'];
    const heatOn = (axis: TableAxis): boolean => table.heat?.[axis]?.[axis === 'rows' ? cell.row : cell.col] !== undefined;
    for (const axis of axes) {
      const command: TableHeatCommand = axis === 'rows' ? 'heat-rows' : 'heat-cols';
      const refusal = refusals[command];
      heatItems.push(
        <ChromeMenuItem key={command} checked={heatOn(axis)} onSelect={run(command)} disabled={refusal !== undefined} {...(refusal !== undefined ? { title: refusal } : {})}>
          {TABLE_HEAT_LABELS.toggle(axis)}
        </ChromeMenuItem>,
      );
    }
    for (const axis of axes.filter(heatOn)) heatItems.push(item(axis === 'rows' ? 'heat-rows-off' : 'heat-cols-off', TABLE_HEAT_LABELS.remove(axis)));
  }

  const first: ReactNode[] = [];
  if (link !== undefined) {
    first.push(
      <CommandItem
        key="open-link"
        label="Open link"
        refusal={links.length > 1 ? severalLinksMessage(coarse) : undefined}
        onSelect={run('open-link')}
        {...(links.length === 1 ? { description: linkDisplayUrl(link) } : {})}
      />,
    );
  }
  if (section) first.push(item('rename', section.text.trim() === '' ? 'Add a title' : 'Rename'));
  const groups: ReactNode[][] = cell
    ? [
        first,
        [
          item('row-above', 'Insert row above'),
          item('row-below', 'Insert row below'),
          item('row-delete', 'Delete row'),
          item('col-left', 'Insert column left'),
          item('col-right', 'Insert column right'),
          item('col-delete', 'Delete column'),
        ],
        heatItems,
        [lockItem],
      ]
    : [[...first, lockItem]];
  groups.push(
    [
      item('cut', 'Cut', keyLabel('X', { mod: true })),
      item('copy', 'Copy', keyLabel('C', { mod: true })),
      item('paste', 'Paste', keyLabel('V', { mod: true })),
      item('duplicate', 'Duplicate', keyLabel('D', { mod: true })),
    ],
    [
      item('front', 'Bring to front', keysOn ? ']' : isApplePlatform() ? keyLabel(']', { mod: true, alt: true }) : keyLabel(']', { mod: true, shift: true })),
      item('back', 'Send to back', keysOn ? '[' : isApplePlatform() ? keyLabel('[', { mod: true, alt: true }) : keyLabel('[', { mod: true, shift: true })),
      item('group', 'Group', keyLabel('G', { mod: true })),
      item('ungroup', 'Ungroup', keyLabel('G', { mod: true, shift: true })),
      item('tidy', 'Tidy up'),
    ],
    [item('delete', 'Delete', isApplePlatform() ? '⌫' : 'Delete', true)],
  );
  if (refusals.ask === undefined) groups.push([item('ask', 'Ask the agent', modKey() + 'K')]);
  return <MenuGroups groups={groups} />;
}

/** The rows of the board menu. */
function BoardMenuItems({ board }: { board: Point | null }) {
  const empty = useBoard((state) => state.board.content.elements.length === 0);
  const agentAvailable = useAgent((state) => state.available);
  const editable = canEditBoard();
  const refusals: Partial<Record<BoardCommand, string>> = {};
  if (!editable) {
    refusals.paste = READ_ONLY_MESSAGE;
    refusals['add-note'] = READ_ONLY_MESSAGE;
  } else if (!canPasteFromMenu()) {
    refusals.paste = INTERNAL_PASTE_ONLY_MESSAGE;
  }
  if (empty) {
    refusals['select-all'] = EMPTY_BOARD_MESSAGE;
    refusals.fit = EMPTY_BOARD_MESSAGE;
  }
  const ask = askRefusal(editable, agentAvailable);
  if (ask) refusals.ask = ask;
  const item = (command: BoardCommand, label: string, shortcut?: string) => (
    <CommandItem key={command} label={label} refusal={refusals[command]} onSelect={() => runBoardCommand(command, board)} {...(shortcut !== undefined ? { shortcut } : {})} />
  );
  return (
    <MenuGroups
      groups={[
        [item('paste', 'Paste', keyLabel('V', { mod: true })), item('select-all', 'Select all', keyLabel('A', { mod: true }))],
        [item('fit', 'Fit the board', keyLabel('0', { mod: true })), item('add-note', 'Add a note here')],
        [item('ask', 'Ask the agent', modKey() + 'K')],
      ]}
    />
  );
}

/** Menu groups with separators between the non-empty ones. */
function MenuGroups({ groups }: { groups: readonly (readonly ReactNode[])[] }) {
  const shown = groups.filter((group) => group.length > 0);
  return (
    <>
      {shown.map((group, index) => (
        <MenuGroupRows key={index} first={index === 0} rows={group} />
      ))}
    </>
  );
}

function MenuGroupRows({ first, rows }: { first: boolean; rows: readonly ReactNode[] }) {
  return (
    <>
      {first ? null : <ChromeMenuSeparator />}
      {rows}
    </>
  );
}

/** The menu itself, anchored at the press. */
function BoardMenuPopup() {
  const open = useContextMenu((state) => state.open);
  const at = useContextMenu((state) => state.at);
  const kind = useContextMenu((state) => state.kind);
  const board = useContextMenu((state) => state.board);
  const cell = useContextMenu((state) => state.cell);
  const count = useSelection((state) => state.ids.length);
  const anchor = useMemo(() => ({ getBoundingClientRect: () => DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }) }), [at]);
  const name = kind === 'board' ? 'Board actions' : count > 1 ? 'Actions for ' + String(count) + ' items' : 'Item actions';
  return (
    <BaseMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) useContextMenu.getState().hide();
      }}
    >
      <BaseMenu.Portal>
        <BaseMenu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2} collisionPadding={8} className="z-[1000]">
          <BaseMenu.Popup data-wb-chrome="" aria-label={name} className={POPUP}>
            {open ? kind === 'items' ? <ItemMenuItems cell={cell} board={board} /> : <BoardMenuItems board={board} /> : null}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/** Wraps the board surface: right-click or long-press opens the board's context menu. */
export function BoardContextMenu({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    return element ? listenForMenu(element) : undefined;
  }, []);
  return (
    <div ref={root} style={{ display: 'contents' }}>
      {children}
      <BoardMenuPopup />
    </div>
  );
}
