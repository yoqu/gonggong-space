/**
 * What every element view puts on its root node: the attributes that make
 * it an item of the list of board items (its spoken description and its
 * place in reading order) and the hooks tools find it by
 * (`data-wb-id`, `data-wb-type`, `data-wb-locked`).
 */

import type { BoardElement, ElementId } from '@open-artifact/whiteboard-core';
import { boardListItemProps, describeElement, type BoardListItemProps } from './describe.ts';
import { useBoardDerived } from './hooks.ts';
import { useElementView } from './view-state.ts';

/** The root attributes of an element view. */
export interface ElementItemProps extends BoardListItemProps {
  id: string;
  tabIndex: -1;
  'data-wb-id': ElementId;
  'data-wb-type': BoardElement['type'];
  'data-wb-locked'?: true;
  /** Set while the element is being dragged (it casts a lifted shadow). */
  'data-wb-lifted'?: true;
}

/** The DOM id of an element's view (the board list owns it by this id). */
export function elementDomId(id: ElementId): string {
  return `wb-${id}`;
}

/** The root attributes of an element view (see the module comment). */
export function useItemProps(element: BoardElement): ElementItemProps {
  const label = useBoardDerived((state, measures) => {
    const current = state.byId.get(element.id);
    return current ? describeElement(current, state.byId, measures) : '';
  }, element.id);
  const pos = useElementView((state) => state.reading.get(element.id));
  const size = useElementView((state) => state.readingSize);
  const lifted = useElementView((state) => state.lifted.has(element.id));
  return {
    ...boardListItemProps(label, pos, size),
    id: elementDomId(element.id),
    tabIndex: -1,
    'data-wb-id': element.id,
    'data-wb-type': element.type,
    ...(element.locked ? { 'data-wb-locked': true as const } : {}),
    ...(lifted ? { 'data-wb-lifted': true as const } : {}),
  };
}
