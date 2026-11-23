/**
 * Animate for the picked layer, as the compact inspector has it: one picker per setting (how it comes in and from
 * where, how it leaves and to where, its timing and speed), and a request to the agent that says it (the agent
 * rewrites the film, so nothing here changes the film by itself). While the layers are read again, Ask waits and
 * says so.
 */

import { useState, type ReactElement } from 'react';
import { Sparkles } from 'lucide-react';
import { announce } from '@open-artifact/editor-kit';
import { Button, Section, type Option } from '@open-artifact/ui';
import {
  animateLayerRequest,
  hasLayerMotionChoice,
  playSeconds,
  type LayerEnter,
  type LayerLeave,
  type LayerMotionChoice,
  type LayerSide,
  type PickedLayer,
} from '@open-artifact/motion-core';
import type { LayerRow } from '@open-artifact/motion-stage/protocol';
import { sendAgentRequest } from '../agent/send.ts';
import { useFilm } from '../stores/film.ts';
import { useWorking } from '../stores/working.ts';
import { AnimatePicker } from './AnimatePicker.tsx';
import { layersUpdating } from './animate.ts';
import { goToLayer } from './reader.ts';
import { clearChoice, setChoice, useLayers } from './store.ts';
import type { LayerStretch } from './stretch.ts';
import { describeMotionChoice } from './motion-words.ts';
import * as words from './words.ts';

const SIDES: readonly LayerSide[] = ['left', 'right', 'top', 'bottom'];

/** The picked layer as the request says it: its kind, moment, box as fractions of the frame, and scene. */
export function pickedLayerOf(row: LayerRow, at: number, stretch: LayerStretch, filmWidth: number, filmHeight: number): PickedLayer | null {
  if (row.box === null || filmWidth <= 0 || filmHeight <= 0) return null;
  const [x, y, w, h] = row.box;
  return {
    kind: row.kind,
    t: playSeconds(at),
    box: { x: x / filmWidth, y: y / filmHeight, w: w / filmWidth, h: h / filmHeight },
    scene: stretch.scene !== null && stretch.index >= 0 ? { n: stretch.index + 1, of: stretch.count } : null,
    ...(row.many >= 2 ? { many: row.many } : {}),
  };
}

export function AnimateGroup({ row, at, stretch }: { row: LayerRow; at: number; stretch: LayerStretch }): ReactElement {
  const choice = useLayers((s) => s.choice);
  const readerState = useLayers((s) => s.state);
  const readAt = useLayers((s) => s.revision);
  const filmRevision = useFilm((s) => s.revision);
  const width = useFilm((s) => s.meta?.width ?? 0);
  const height = useFilm((s) => s.meta?.height ?? 0);
  const inScenes = useFilm((s) => (s.meta?.scenes ?? null) !== null);
  const chapters = useFilm((s) => s.meta?.chapters.length ?? 0);
  const clock = useFilm((s) => s.clock);
  const working = useWorking((s) => s.activity === 'working');
  const [sending, setSending] = useState(false);
  const canStay = inScenes || chapters === 0;
  const picked = pickedLayerOf(row, at, stretch, width, height);
  const request = picked === null ? null : animateLayerRequest(picked, choice, clock);
  const summary = describeMotionChoice(row.kind, row.many, choice, inScenes);
  const askable = hasLayerMotionChoice(choice) && !working && !sending;
  // The box and moment above may be old: Ask stays focusable but waits.
  const updating = askable && layersUpdating(readerState, readAt, filmRevision);
  const set = (change: Partial<LayerMotionChoice>): void => setChoice(change);

  const enterOptions: Option<LayerEnter>[] = (['fade', 'slide', 'pop', 'type'] as const)
    .filter((each) => each !== 'type' || row.kind === 'text')
    .map((value) => ({ value, label: words.ENTER_LABELS[value], title: words.ENTER_LABELS[value] }));
  const leaveOptions: Option<LayerLeave>[] = (['fade', 'slide', 'shrink', 'stay'] as const)
    .filter((each) => each !== 'stay' || canStay)
    .map((value) => ({ value, label: words.LEAVE_LABELS[value], title: words.LEAVE_LABELS[value] }));
  const sideOptions: Option<LayerSide>[] = SIDES.map((value) => ({ value, label: words.SIDE_LABELS[value], title: words.SIDE_LABELS[value] }));

  const ask = async (): Promise<void> => {
    if (request === null) return;
    setSending(true);
    try {
      const outcome = await sendAgentRequest(request);
      if (outcome !== 'failed') clearChoice();
    } finally {
      setSending(false);
    }
  };

  const press = (): void => {
    const layers = useLayers.getState();
    if (layersUpdating(layers.state, layers.revision, useFilm.getState().revision)) announce(words.STILL_UPDATING);
    else void ask();
  };

  return (
    <Section title={words.ANIMATE_TITLE}>
      <div className="flex flex-col gap-1.5" role="group" aria-label={words.ANIMATE_TITLE}>
        <AnimatePicker label={words.COMES_IN} value={choice.enter} options={enterOptions} onPick={(enter) => set({ enter })} />
        {choice.enter === 'slide' ? (
          <AnimatePicker
            label={words.SLIDES_IN_FROM}
            shortLabel={words.FROM}
            value={choice.enterFrom}
            options={sideOptions}
            holds
            onPick={(side) => side !== null && set({ enterFrom: side })}
          />
        ) : null}
        <AnimatePicker label={words.LEAVES} value={choice.leave} options={leaveOptions} onPick={(leave) => set({ leave })} />
        {choice.leave === 'slide' ? (
          <AnimatePicker
            label={words.SLIDES_OUT_TO}
            shortLabel={words.TO}
            value={choice.leaveTo}
            options={sideOptions}
            holds
            onPick={(side) => side !== null && set({ leaveTo: side })}
          />
        ) : null}
        <AnimatePicker
          label={words.TIMING}
          value={choice.when}
          options={(['earlier', 'later'] as const).map((value) => ({ value, label: words.WHEN_LABELS[value], title: words.WHEN_LABELS[value] }))}
          onPick={(when) => set({ when })}
        />
        <AnimatePicker
          label={words.LAYER_SPEED}
          shortLabel={words.LAYER_SPEED_SHORT}
          value={choice.pace}
          options={(['slower', 'faster'] as const).map((value) => ({ value, label: words.PACE_LABELS[value], title: words.PACE_LABELS[value] }))}
          onPick={(pace) => set({ pace })}
        />
      </div>
      {picked === null ? (
        <div className="flex flex-col items-start gap-1.5 pt-1">
          <p className="text-xs text-fg-muted">{words.NOT_ON_PICTURE}</p>
          <Button size="sm" onClick={() => goToLayer(row)}>
            {words.GO_TO_IT}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 pt-1">
          <p className="text-xs text-fg" role="status">
            {summary ?? words.PICK_A_CHANGE}
          </p>
          {working ? <p className="text-xs text-fg-muted">{words.AGENT_WORKING}</p> : null}
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="primary"
              icon={<Sparkles className="size-3.5" />}
              disabled={!askable}
              aria-disabled={updating || undefined}
              className={updating ? '[&>*]:opacity-40' : undefined}
              onClick={press}
            >
              <span>{words.ASK_THE_AGENT}</span>
            </Button>
            {hasLayerMotionChoice(choice) ? (
              <Button size="sm" variant="ghost" onClick={() => clearChoice()}>
                {words.CLEAR_CHOICE}
              </Button>
            ) : null}
          </div>
          {request !== null ? (
            <details className="text-xs text-fg-subtle">
              <summary className="cursor-pointer select-none">{words.WHAT_THE_AGENT_READS}</summary>
              <p className="whitespace-pre-wrap pt-1">{request.text}</p>
            </details>
          ) : null}
        </div>
      )}
    </Section>
  );
}
