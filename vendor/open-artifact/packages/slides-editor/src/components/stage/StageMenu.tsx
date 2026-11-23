/**
 * The stage's right-click menu: element commands when something is
 * selected, otherwise paste, select all and the slide's own commands.
 */

import { useState, type ReactNode } from 'react';
import {
  BringToFront,
  ClipboardPaste,
  Copy,
  Crop,
  Group,
  ImageUp,
  MessageCircle,
  Paintbrush,
  Scissors,
  SendToBack,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react';
import { isTextual, nodeAt, rotationOf, samePath, type NodePath, type TableNode } from '@open-artifact/slides-core';
import { MenuItem, MenuSeparator, toast } from '@open-artifact/ui';
import { useView } from '../../state/view.ts';
import { tableTarget } from '../../lib/table-target.ts';
import { hasMemory, pasteFromMemory } from '../../services/clipboard.ts';
import { replaceImage, pickFiles } from '../../services/assets.ts';
import { canComment, elementAnchor, requestAnchoredComment } from '../../services/comments.ts';
import {
  copyStyle,
  currentSlide,
  deleteSelection,
  duplicateSelection,
  editableEntry,
  enterSelection,
  groupSelection,
  pasteStyle,
  reorderSelection,
  selectAll,
  selectedPaths,
  ungroupSelection,
  editTable,
  tableAddRefusal,
  tableRemoveRefusal,
} from '../../services/commands.ts';
import { SlideMenuItems } from '../SlideMenu.tsx';
import { MOD } from '@open-artifact/editor-kit';

const ALT = MOD === '⌘' ? '⌥' : 'Alt+';
const SHIFT = MOD === '⌘' ? '⇧' : 'Shift+';

/** Runs the browser's copy / cut so the document clipboard handlers write the payload. */
function clipboardCommand(command: 'copy' | 'cut'): void {
  // A menu click is a user gesture: the browser fires the copy / cut event.
  if (!document.execCommand(command)) toast.add({ title: `Use ${MOD}${command === 'copy' ? 'C' : 'X'} to ${command}` });
}

/** Items of the stage menu. */
export function StageMenuItems(): ReactNode {
  const view = useView.getState();
  const slide = currentSlide();
  const editable = editableEntry(view.current) !== null;
  const paths = selectedPaths();
  if (!slide || !view.current) return null;

  if (paths.length === 0) {
    return (
      <>
        {editable ? (
          <MenuItem icon={<ClipboardPaste className="size-4" />} shortcut={`${MOD}V`} disabled={!hasMemory()} onSelect={() => pasteFromMemory()}>
            Paste
          </MenuItem>
        ) : null}
        <MenuItem shortcut={`${MOD}A`} onSelect={selectAll}>
          Select all
        </MenuItem>
        {canComment() ? (
          <MenuItem icon={<MessageCircle className="size-4" />} onSelect={() => requestAnchoredComment(elementAnchor(slide, null))}>
            Comment on slide
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <SlideMenuItems ids={[view.current]} />
      </>
    );
  }

  const single = paths.length === 1 ? paths[0]! : null;
  const node = single ? nodeAt(slide, single) : undefined;
  const isGroup = node?.kind === 'box' && node.group;
  return (
    <>
      {editable ? (
        <MenuItem icon={<Scissors className="size-4" />} shortcut={`${MOD}X`} onSelect={() => clipboardCommand('cut')}>
          Cut
        </MenuItem>
      ) : null}
      <MenuItem icon={<Copy className="size-4" />} shortcut={`${MOD}C`} onSelect={() => clipboardCommand('copy')}>
        Copy
      </MenuItem>
      {editable ? (
        <>
          <MenuItem icon={<ClipboardPaste className="size-4" />} shortcut={`${MOD}V`} disabled={!hasMemory()} onSelect={() => pasteFromMemory()}>
            Paste
          </MenuItem>
          <MenuItem shortcut={`${MOD}D`} onSelect={duplicateSelection}>
            Duplicate
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-4" />} shortcut="⌫" danger onSelect={deleteSelection}>
            Delete
          </MenuItem>
          <MenuSeparator />
          {node && isTextual(node) ? (
            <MenuItem icon={<Type className="size-4" />} shortcut="↵" onSelect={enterSelection}>
              Edit text
            </MenuItem>
          ) : null}
          {node?.kind === 'image' && node.src ? (
            <MenuItem
              icon={<Crop className="size-4" />}
              onSelect={() => {
                if (rotationOf(node)) toast.add({ title: 'Straighten the picture to crop it' });
                else useView.getState().setCropping(single);
              }}
            >
              Crop
            </MenuItem>
          ) : null}
          {node?.kind === 'image' && single ? (
            <MenuItem
              icon={<ImageUp className="size-4" />}
              onSelect={() => {
                void pickFiles('image/png,image/jpeg,image/gif,image/webp,image/svg+xml', false).then((files) => {
                  if (files[0]) void replaceImage(single, files[0]);
                });
              }}
            >
              Replace picture…
            </MenuItem>
          ) : null}
          {node?.kind === 'table' && single ? <TableMenuItems table={node} path={single} /> : null}
          <MenuItem icon={<BringToFront className="size-4" />} shortcut="]" onSelect={() => reorderSelection('front')}>
            Bring to front
          </MenuItem>
          <MenuItem shortcut={`${MOD}]`} onSelect={() => reorderSelection('forward')}>
            Bring forward
          </MenuItem>
          <MenuItem shortcut={`${MOD}[`} onSelect={() => reorderSelection('backward')}>
            Send backward
          </MenuItem>
          <MenuItem icon={<SendToBack className="size-4" />} shortcut="[" onSelect={() => reorderSelection('back')}>
            Send to back
          </MenuItem>
          <MenuSeparator />
          {paths.length > 1 ? (
            <MenuItem icon={<Group className="size-4" />} shortcut={`${MOD}G`} onSelect={groupSelection}>
              Group
            </MenuItem>
          ) : null}
          {isGroup ? (
            <MenuItem icon={<Ungroup className="size-4" />} shortcut={`${SHIFT}${MOD}G`} onSelect={ungroupSelection}>
              Ungroup
            </MenuItem>
          ) : null}
          <MenuItem icon={<Paintbrush className="size-4" />} shortcut={`${ALT}${MOD}C`} onSelect={copyStyle}>
            Copy style
          </MenuItem>
          <MenuItem shortcut={`${ALT}${MOD}V`} disabled={!view.styleClipboard} onSelect={pasteStyle}>
            Paste style
          </MenuItem>
        </>
      ) : null}
      {canComment() && single ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<MessageCircle className="size-4" />} onSelect={() => requestAnchoredComment(elementAnchor(slide, single))}>
            Comment
          </MenuItem>
        </>
      ) : null}
    </>
  );
}

/**
 * Rows and columns of a selected table: around the cell being typed in, or
 * at the end (adding) and the last one (removing) otherwise. The table and
 * cell are taken as the menu opens; the commands check them when chosen.
 */
function TableMenuItems({ table, path }: { table: TableNode; path: NodePath }): ReactNode {
  const [opened] = useState(() => {
    const { textEdit: edit, current } = useView.getState();
    return tableTarget(current ?? '', path, table, edit?.cell && samePath(edit.path, path) ? edit.cell : undefined);
  });
  const cell = opened.cell ?? null;
  const addRow = tableAddRefusal(table, 'row');
  const addColumn = tableAddRefusal(table, 'column');
  const removeRow = tableRemoveRefusal(table, 'row');
  const removeColumn = tableRemoveRefusal(table, 'column');
  return (
    <>
      {cell ? (
        <>
          <MenuItem disabled={addRow !== null} onSelect={() => editTable(opened.path, 'addRow', cell[0], opened)}>
            Insert row above
          </MenuItem>
          <MenuItem disabled={addRow !== null} onSelect={() => editTable(opened.path, 'addRow', cell[0] + 1, opened)}>
            Insert row below
          </MenuItem>
          <MenuItem disabled={addColumn !== null} onSelect={() => editTable(opened.path, 'addColumn', cell[1], opened)}>
            Insert column left
          </MenuItem>
          <MenuItem disabled={addColumn !== null} onSelect={() => editTable(opened.path, 'addColumn', cell[1] + 1, opened)}>
            Insert column right
          </MenuItem>
          <MenuItem disabled={removeRow !== null} onSelect={() => editTable(opened.path, 'removeRow', cell[0], opened)}>
            Delete row
          </MenuItem>
          <MenuItem disabled={removeColumn !== null} onSelect={() => editTable(opened.path, 'removeColumn', cell[1], opened)}>
            Delete column
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem disabled={addRow !== null} onSelect={() => editTable(opened.path, 'addRow', undefined, opened)}>
            Add a row
          </MenuItem>
          <MenuItem disabled={addColumn !== null} onSelect={() => editTable(opened.path, 'addColumn', undefined, opened)}>
            Add a column
          </MenuItem>
          <MenuItem disabled={removeRow !== null} onSelect={() => editTable(opened.path, 'removeRow', undefined, opened)}>
            Remove the last row
          </MenuItem>
          <MenuItem disabled={removeColumn !== null} onSelect={() => editTable(opened.path, 'removeColumn', undefined, opened)}>
            Remove the last column
          </MenuItem>
        </>
      )}
      <MenuSeparator />
    </>
  );
}
