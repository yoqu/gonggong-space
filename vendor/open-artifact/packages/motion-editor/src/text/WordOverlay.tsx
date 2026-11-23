import type { CSSProperties, ReactElement } from 'react';
import { Tip } from '@open-artifact/editor-kit/react';
import { cn } from '@open-artifact/ui';
import type { TextBox } from '@open-artifact/motion-core';
import type { StageOverlayContext } from '../player/overlays.ts';
import { useUi } from '../stores/ui.ts';
import { useWorking } from '../stores/working.ts';
import { TWEAKS_PANEL } from '../tweaks/panel-id.ts';
import { askForWord, useEditableWords, useText } from './text-store.ts';
import * as words from './words.ts';

const percent = (fraction: number): string => `${fraction * 100}%`;

function placed(box: TextBox, width: number, height: number): CSSProperties {
  return { left: percent(box.x / width), top: percent(box.y / height), width: percent(box.w / width), height: percent(box.h / height) };
}

function chooseWord(id: string): void {
  if (useUi.getState().panel !== TWEAKS_PANEL) useUi.getState().openPanel(TWEAKS_PANEL);
  askForWord(id);
}

/**
 * A button over each box of a line that can be retyped, while the picture holds still; pressing one opens Tweaks at
 * its field. With Tweaks open, words that have no field say so on hover.
 */
export function WordOverlay({ filmWidth, filmHeight }: StageOverlayContext): ReactElement | null {
  const panelOpen = useUi((s) => s.panel === TWEAKS_PANEL);
  const agentWorking = useWorking((s) => s.activity === 'working');
  const agent = useWorking((s) => s.name);
  const active = useText((s) => s.held?.id ?? null);
  const near = useText((s) => s.near);
  const { words: list, fieldless } = useEditableWords();
  if (!(filmWidth > 0) || !(filmHeight > 0) || (!panelOpen && agentWorking)) return null;
  // Bigger boxes go under smaller ones, so a word inside a heading's box can still be pressed.
  const items = list
    .flatMap((word) => word.boxes.map((box, index) => ({ word, box, key: `${word.id} ${index}` })))
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  return (
    <>
      {panelOpen
        ? fieldless.map((box) => (
            <Tip key={`${box.x} ${box.y} ${box.w} ${box.h}`} label={words.fieldlessNote(agent)} side="top">
              <span className="absolute cursor-help" style={placed(box, filmWidth, filmHeight)} onClick={(event) => event.stopPropagation()} />
            </Tip>
          ))
        : null}
      {items.map(({ word, box, key }, index) => (
        <button
          key={key}
          type="button"
          tabIndex={-1}
          aria-label={words.changeWords(word.text)}
          className={cn(
            'absolute cursor-text rounded-[3px] outline-offset-2 transition-[outline-color] hover:outline-2 hover:outline-chrome-accent/70',
            near === word.id && 'outline-2 outline-chrome-accent/70',
            active === word.id && 'outline-2 outline-chrome-accent',
          )}
          style={{ ...placed(box, filmWidth, filmHeight), zIndex: index + 1 }}
          onPointerEnter={() => useText.setState({ near: word.id })}
          onPointerLeave={() => useText.setState((state) => (state.near === word.id ? { near: null } : state))}
          onClick={(event) => {
            event.stopPropagation();
            chooseWord(word.id);
          }}
        />
      ))}
    </>
  );
}
