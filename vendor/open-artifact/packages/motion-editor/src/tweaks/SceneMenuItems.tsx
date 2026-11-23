import { useState, type ReactElement } from 'react';
import { Pencil, RotateCcw, Timer } from 'lucide-react';
import { Button, Dialog, MenuItem, ScrubNumberField, TextInput } from '@open-artifact/ui';
import { EMPTY_RECUT_RECORD, MAX_SCENE_NAME_CHARS, SCENE_DURATION_STEP, partRecut, type ClockPart } from '@open-artifact/motion-core';
import { pause } from '../engine/actions.ts';
import { setSceneLength, setSceneName } from '../recut/actions.ts';
import { roundTenths, scaledSceneLength, sceneLengthBounds } from '../recut/bounds.ts';
import { selectParts, useFilm } from '../stores/film.ts';
import type { SceneMenuContext } from '../timeline/scene-menu.ts';
import * as words from './words.ts';

function useScene(index: number): { part: ClockPart; parts: readonly ClockPart[]; byHand: ReturnType<typeof partRecut> } | null {
  const parts = useFilm(selectParts);
  const recut = useFilm((s) => s.records.recut);
  const part = parts[index];
  if (part === undefined) return null;
  return { part, parts, byHand: partRecut(recut ?? EMPTY_RECUT_RECORD, parts, index) };
}

/** Shortening a playing scene is refused, so a length chosen from the menu pauses first. */
function lengthen(index: number, part: ClockPart, length: number | null): void {
  if ((length ?? part.filmDur) < part.playDur) pause();
  void setSceneLength(index, length);
}

function RenameDialog({ index, label, close }: { index: number; label: string; close: () => void }): ReactElement {
  const [name, setName] = useState(label);
  const save = (): void => {
    setSceneName(index, name.trim() === '' ? null : name);
    close();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={words.renameSceneTitle(label)}
      footer={
        <>
          <Button onClick={close}>{words.CANCEL}</Button>
          <Button variant="primary" onClick={save}>
            {words.RENAME}
          </Button>
        </>
      }
    >
      <TextInput
        autoFocus
        aria-label={words.NAME}
        value={name}
        maxLength={MAX_SCENE_NAME_CHARS}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          save();
        }}
      />
    </Dialog>
  );
}

function LengthDialog({ index, close }: { index: number; close: () => void }): ReactElement | null {
  const parts = useFilm(selectParts);
  const part = parts[index];
  const bounds = sceneLengthBounds(parts, index);
  const [seconds, setSeconds] = useState<number | null>(part === undefined ? null : roundTenths(part.playDur));
  if (part === undefined || bounds === null) return null;
  const save = (): void => {
    if (seconds !== null) lengthen(index, part, seconds);
    close();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={words.sceneLengthTitle(part.label)}
      footer={
        <>
          <Button onClick={close}>{words.CANCEL}</Button>
          <Button variant="primary" onClick={save}>
            {words.SET_LENGTH}
          </Button>
        </>
      }
    >
      <ScrubNumberField
        aria-label={words.LENGTH}
        value={seconds}
        unit={words.SECONDS_UNIT}
        step={SCENE_DURATION_STEP}
        largeStep={1}
        precision={1}
        min={bounds.min}
        max={bounds.max}
        onChange={setSeconds}
        onCommit={setSeconds}
      />
    </Dialog>
  );
}

/** Rename the scene, or give it its own name back. */
export function SceneNameItems({ span, showDialog }: SceneMenuContext): ReactElement | null {
  const scene = useScene(span.index);
  if (scene === null) return null;
  const { index } = span;
  const label = scene.part.label;
  return (
    <>
      <MenuItem icon={<Pencil className="size-4" />} onSelect={() => showDialog((close) => <RenameDialog index={index} label={label} close={close} />)}>
        {words.RENAME_SCENE}
      </MenuItem>
      {scene.byHand.name !== null ? (
        <MenuItem icon={<RotateCcw className="size-4" />} onSelect={() => setSceneName(index, null)}>
          {words.RESET_NAME}
        </MenuItem>
      ) : null}
    </>
  );
}

/** Set how long the scene plays, or give it its own length back. */
export function SceneLengthItems({ span, showDialog }: SceneMenuContext): ReactElement | null {
  const scene = useScene(span.index);
  if (scene === null || sceneLengthBounds(scene.parts, span.index) === null) return null;
  const { index } = span;
  const { part } = scene;
  return (
    <>
      <MenuItem icon={<Timer className="size-4" />} onSelect={() => showDialog((close) => <LengthDialog index={index} close={close} />)}>
        {words.CHANGE_LENGTH}
      </MenuItem>
      {scene.byHand.dur !== null ? (
        <MenuItem icon={<RotateCcw className="size-4" />} onSelect={() => lengthen(index, part, null)}>
          {words.RESET_LENGTH}
        </MenuItem>
      ) : null}
    </>
  );
}

/** Play the scene at half or double speed (twice or half as long), within the lengths it may have. */
export function SceneSpeedItems({ span }: SceneMenuContext): ReactElement | null {
  const scene = useScene(span.index);
  const bounds = scene === null ? null : sceneLengthBounds(scene.parts, span.index);
  if (scene === null || bounds === null) return null;
  const { index } = span;
  const { part } = scene;
  const slower = scaledSceneLength(bounds, part.playDur, 0.5);
  const faster = scaledSceneLength(bounds, part.playDur, 2);
  return (
    <>
      <MenuItem shortcut={words.HALF_SPEED_MARK} disabled={slower === null} onSelect={() => slower !== null && lengthen(index, part, slower)}>
        {slower === null ? words.CANT_GO_SLOWER : words.HALF_SPEED}
      </MenuItem>
      <MenuItem shortcut={words.DOUBLE_SPEED_MARK} disabled={faster === null} onSelect={() => faster !== null && lengthen(index, part, faster)}>
        {faster === null ? words.CANT_GO_FASTER : words.DOUBLE_SPEED}
      </MenuItem>
    </>
  );
}
