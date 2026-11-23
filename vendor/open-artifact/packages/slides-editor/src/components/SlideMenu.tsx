/**
 * The slide menu (right-click on a thumbnail in the rail, grid or canvas):
 * clipboard, duplicate, delete, skip, cover, sections, moves and links.
 */

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, CopyPlus, Eye, EyeOff, Image, Link, ListPlus, Plus, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { MenuItem, MenuSeparator } from '@open-artifact/ui';
import { maybeSession } from '../services/session.ts';
import { useDeck } from '../state/deck.ts';
import { askAgentToFix, useAgent } from '../services/agent.ts';
import { copySlidesToMemory, hasMemory, pasteFromMemory } from '../services/clipboard.ts';
import {
  addSlide,
  canChange,
  copySlideLink,
  deleteSlides,
  duplicateSlides,
  nudgeSlides,
  setCoverSlide,
  setSlidesHidden,
  slidesToNewSection,
  startSectionAt,
} from '../services/commands.ts';
import { MOD } from '@open-artifact/editor-kit';

/** Menu items acting on `ids` (in deck order). */
export function SlideMenuItems({ ids }: { ids: readonly string[] }): ReactNode {
  const deck = useDeck.getState();
  const editing = canChange();
  const agent = useAgent.getState().status.available;
  if (ids.length === 0) return null;
  const single = ids.length === 1 ? ids[0]! : null;
  const allHidden = ids.every((id) => deck.slides[id]?.slide.hidden);
  const held = ids.filter((id) => deck.slides[id]?.held);
  const startsSection = single ? Object.values(deck.index.sections).some((s) => s.start === single) : false;
  const many = ids.length > 1 ? ` ${ids.length} slides` : '';
  return (
    <>
      <MenuItem icon={<Copy className="size-4" />} shortcut={`${MOD}C`} onSelect={() => copySlidesToMemory(ids)}>
        Copy{many}
      </MenuItem>
      {editing ? (
        <>
          <MenuItem
            icon={<Scissors className="size-4" />}
            shortcut={`${MOD}X`}
            onSelect={() => {
              copySlidesToMemory(ids);
              deleteSlides(ids);
            }}
          >
            Cut{many}
          </MenuItem>
          <MenuItem icon={<ClipboardPaste className="size-4" />} shortcut={`${MOD}V`} disabled={!hasMemory()} onSelect={() => pasteFromMemory()}>
            Paste
          </MenuItem>
          <MenuItem icon={<CopyPlus className="size-4" />} shortcut={`${MOD}D`} onSelect={() => duplicateSlides(ids)}>
            Duplicate{many}
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-4" />} shortcut="⌫" danger onSelect={() => deleteSlides(ids)}>
            Delete{many}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={allHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} onSelect={() => setSlidesHidden(ids, !allHidden)}>
            {allHidden ? 'Don’t skip' : 'Skip when presenting'}
          </MenuItem>
          {single ? (
            <MenuItem icon={<Image className="size-4" />} disabled={deck.index.cover === single} onSelect={() => setCoverSlide(single)}>
              Use as cover thumbnail
            </MenuItem>
          ) : null}
          <MenuItem icon={<ListPlus className="size-4" />} onSelect={() => slidesToNewSection(ids)}>
            Move to new section
          </MenuItem>
          {single && !startsSection ? (
            <MenuItem icon={<ListPlus className="size-4" />} onSelect={() => startSectionAt(single)}>
              Start a section here
            </MenuItem>
          ) : null}
          <MenuItem icon={<Plus className="size-4" />} onSelect={() => addSlide('blank', ids[ids.length - 1]!)}>
            Add slide after
          </MenuItem>
          <MenuItem icon={<ArrowUp className="size-4" />} onSelect={() => nudgeSlides(-1, ids)}>
            Move up
          </MenuItem>
          <MenuItem icon={<ArrowDown className="size-4" />} onSelect={() => nudgeSlides(1, ids)}>
            Move down
          </MenuItem>
        </>
      ) : null}
      {single && maybeSession()?.shell ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<Link className="size-4" />} shortcut={`⌥${MOD}L`} onSelect={() => void copySlideLink(single)}>
            Copy link to slide
          </MenuItem>
        </>
      ) : null}
      {held.length && agent && editing ? (
        <MenuItem icon={<Sparkles className="size-4" />} onSelect={() => void askAgentToFix(held)}>
          Ask agent to fix
        </MenuItem>
      ) : null}
    </>
  );
}
