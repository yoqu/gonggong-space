/**
 * One of Animate's pickers: its options side by side, or a menu led by "No change" when they do not fit the panel.
 * Picking the picked option again lets it go; a picker that holds (a direction) keeps it, and its menu has no
 * "No change".
 */

import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Row, Segmented, SelectInput, type Option } from '@open-artifact/ui';
import { NO_CHANGE_ITEM, menuKept, menuUnder, pickerWrite, spillOf } from './animate.ts';
import * as words from './words.ts';

/** How far the segments of the picker inside `group` reach past it. */
function measureSpill(group: Element): number {
  const segments = [...group.querySelectorAll<HTMLElement>('button')];
  const wraps = segments.some((segment) => segment.scrollHeight > segment.clientHeight + 1);
  return spillOf(
    group.getBoundingClientRect(),
    segments.map((segment) => segment.getBoundingClientRect()),
    wraps,
  );
}

export function AnimatePicker<T extends string>({
  label,
  shortLabel,
  value,
  options,
  holds = false,
  onPick,
}: {
  label: string;
  shortLabel?: string;
  value: T | null;
  options: Option<T>[];
  /** A direction: re-picks keep the pick. */
  holds?: boolean;
  onPick: (value: T | null) => void;
}): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  // The width under which the options show as a menu; null: they show side by side.
  const [under, setUnder] = useState<number | null>(null);
  const optionsKey = options.map((option) => option.value).join(' ');
  const [measuredKey, setMeasuredKey] = useState(optionsKey);
  if (measuredKey !== optionsKey) {
    setMeasuredKey(optionsKey);
    setUnder(null);
  }

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const segmentsOf = (): Element | null => element.querySelector('[role="group"]');
    const measure = (): void => {
      const group = segmentsOf();
      if (group !== null) setUnder(menuUnder(element.clientWidth, measureSpill(group)));
      else setUnder((was) => menuKept(element.clientWidth, was));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    let live = true;
    // The labels change width when the fonts arrive: measure again, with the segments shown to do it.
    if (document.fonts?.status === 'loading')
      void document.fonts.ready.then(() => {
        if (!live) return;
        if (segmentsOf() !== null) measure();
        else setUnder(null);
      });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [under, optionsKey]);

  const write = (pressed: T | typeof NO_CHANGE_ITEM, from: 'segments' | 'menu'): void => {
    const next = pickerWrite(value, pressed, from, holds);
    if (next !== undefined) onPick(next);
  };

  return (
    <Row label={shortLabel ?? label}>
      <div ref={box} className="min-w-0 flex-1">
        {under === null ? (
          <Segmented<T>
            aria-label={label}
            className="w-full text-xs"
            value={value}
            options={options}
            onChange={(next) => write(next, 'segments')}
            onRepick={(again) => write(again, 'segments')}
          />
        ) : (
          <SelectInput<T | typeof NO_CHANGE_ITEM>
            aria-label={label}
            className="text-xs"
            value={value}
            placeholder={words.NO_CHANGE}
            options={holds ? options : [{ value: NO_CHANGE_ITEM, label: words.NO_CHANGE }, ...options]}
            onChange={(next) => write(next, 'menu')}
          />
        )}
      </div>
    </Row>
  );
}
