/**
 * Views of the elements that hold text in a box: sticky notes, shapes,
 * free text and sections (containers with a title above them).
 *
 * Each view renders its stored Markdown as rich text, and swaps in the
 * in-place {@link TextEditor} while its text is being edited. Sizes that
 * depend on the text (a note's height, a text's box, a section title's
 * width) are measured and reported to the measures store.
 */

import { ShapeFace } from '../elements/ShapeFace.tsx';
import { memo, useEffect, useRef, type RefObject } from 'react';
import { Lock } from 'lucide-react';
import {
  NOTE_SHADOWS,
  TEXT_PROFILES,
  blockColorHex,
  boxShadowCss,
  chipColorOn,
  containerTitleScale,
  containerTitleScaleForZoom,
  containerTitleScaledGap,
  CONTAINER_TITLE_GAP_SCALED,
  inkColorOnFill,
  noteAuthorBottomPadding,
  sectionFillColor,
  sectionInkColor,
  sectionLineColor,
  shapeFillPaint,
  shapePathData,
  shapeTextInsetStyle,
  showsTextPlaceholder,
  textProfileForElement,
  type ContainerElement,
  type NoteElement,
  type ShapeElement,
  type TextElement,
} from '@open-artifact/whiteboard-core';
import { paperTextColor, textAlignOf } from '../export/look.ts';
import { maybeSession } from '../services/session.ts';
import { useCamera } from '../state/camera.ts';
import { currentMeasures, useMeasures } from '../state/measures.ts';
import { useColorScheme } from '../state/theme.ts';
import { useSectionHover } from '../tools/hover.ts';
import { editTextActionLabel, placeholderHintId, placeholderNeedsDescription } from './describe.ts';
import { useIsFeatured, useMeasureNode } from './hooks.ts';
import { useSelection } from '../state/selection.ts';
import { useItemProps } from './item.tsx';
import { RichText } from './markup.tsx';
import { alignStyle, fontStyle, paperFont, rotationStyle, type ViewStyle } from './style.ts';
import { TextEditor, useEditing, writeElementText } from './TextEditor.tsx';
import { useElementView } from './view-state.ts';

/* ------------------------------------------------------------------------ */
/* Sticky note                                                              */
/* ------------------------------------------------------------------------ */

/** A sticky note: colored paper with rich text and, optionally, who last edited it. */
export const NoteView = memo(function NoteView({ element }: { element: NoteElement }) {
  const scheme = useColorScheme();
  const item = useItemProps(element);
  const editing = useEditing(element.id, 'element');
  const font = paperFont(element.size);
  const ref = useMeasureNode<HTMLDivElement>(element.id, 'h', `${element.text}|${element.w}|${element.size ?? ''}|${editing !== null}|${element.author ?? ''}`);
  const fill = blockColorHex(element.color);
  const style: ViewStyle = {
    left: element.x,
    top: element.y,
    width: element.w,
    ...rotationStyle(element),
    '--wb-note-fill': fill,
    '--wb-paper-text': paperTextColor(element, scheme),
    '--wb-paper-chip': chipColorOn(fill),
    '--wb-note-shadow': boxShadowCss(NOTE_SHADOWS[scheme]),
  };
  const paper: ViewStyle = {
    minHeight: element.h,
    transform: element.tilt ? `rotate(${element.tilt}deg)` : undefined,
    ...fontStyle(font),
    ...alignStyle(textAlignOf(element)),
    ...(element.author ? { paddingBottom: noteAuthorBottomPadding } : {}),
  };
  return (
    <div {...item} className="wb-el wb-note" style={style}>
      <div ref={ref} className="wb-note-paper" style={paper}>
        {editing ? (
          <TextEditor
            target={editing}
            value={element.text}
            onChange={(text) => writeElementText(element.id, text)}
            profile={TEXT_PROFILES.note}
            label={editTextActionLabel(element)}
            hint="Type something"
          />
        ) : (
          <RichText text={element.text} profile={TEXT_PROFILES.note} font={font} />
        )}
        {element.author ? (
          <div className="wb-note-author">
            <span className="wb-sr">Last edited by </span>
            {element.author}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------------ */
/* Shape                                                                    */
/* ------------------------------------------------------------------------ */

/** A shape: its outline drawn in SVG, with centered rich text inside its text area. */
export const ShapeView = memo(function ShapeView({ element }: { element: ShapeElement }) {
  const scheme = useColorScheme();
  const item = useItemProps(element);
  const editing = useEditing(element.id, 'element');
  const font = paperFont(element.size);
  const { w, h } = element;
  const fill = shapeFillPaint(element);
  const style: ViewStyle = {
    left: element.x,
    top: element.y,
    width: w,
    height: h,
    ...rotationStyle(element),
    '--wb-paper-text': paperTextColor(element, scheme),
    ...(fill !== 'none' ? { '--wb-paper-chip': chipColorOn(fill) } : {}),
  };
  const label: ViewStyle = { ...shapeTextInsetStyle(element), ...fontStyle(font), ...alignStyle(textAlignOf(element)) };
  return (
    <div {...item} className={element.hollow ? 'wb-el wb-shape wb-hollow' : 'wb-el wb-shape'} style={style}>
      <ShapeFace element={element} scheme={scheme} />
      <div className="wb-shape-label" style={label}>
        <div className="wb-shape-text">
          {editing ? (
            <TextEditor
              target={editing}
              value={element.text}
              onChange={(text) => writeElementText(element.id, text)}
              profile={TEXT_PROFILES.block}
              label={editTextActionLabel(element)}
            />
          ) : (
            <RichText text={element.text} profile={TEXT_PROFILES.block} font={font} />
          )}
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------------ */
/* Text                                                                     */
/* ------------------------------------------------------------------------ */

/** Free text: one line per line unless it has a wrap width; its size is measured. */
export const TextView = memo(function TextView({ element }: { element: TextElement }) {
  const scheme = useColorScheme();
  const item = useItemProps(element);
  const editing = useEditing(element.id, 'element');
  const backdrop = useElementView((state) => state.backdrops.get(element.id));
  const font = paperFont(element.size);
  const hinted = showsTextPlaceholder(element);
  const ref = useMeasureNode<HTMLDivElement>(element.id, 'wh', `${element.text}|${element.size}|${element.wrap ?? ''}|${editing !== null}|${hinted ? element.placeholder : ''}`);
  const hintId = hinted && placeholderNeedsDescription(element.placeholder) ? placeholderHintId(element.id) : undefined;
  const style: ViewStyle = {
    left: element.x,
    top: element.y,
    ...(element.wrap !== undefined ? { width: element.wrap } : {}),
    ...rotationStyle(element),
    ...fontStyle(font),
    ...alignStyle(element.textAlign ?? 'left'),
    '--wb-ink': inkColorOnFill(element.color, backdrop, scheme),
    ...(backdrop !== undefined ? { '--wb-paper-chip': chipColorOn(backdrop) } : {}),
  };
  const className = `wb-el wb-text wb-text-${element.size}${element.wrap !== undefined ? ' wb-text-wrap' : ''}${hinted ? ' wb-text-hinted' : ''}`;
  return (
    <div {...item} {...(hintId !== undefined ? { 'aria-describedby': hintId } : {})} ref={ref} className={className} style={style} data-wb-backdrop={backdrop !== undefined || undefined}>
      {hinted ? (
        <div className="wb-text-hint" aria-hidden="true">
          {element.placeholder}
        </div>
      ) : null}
      {editing ? (
        <TextEditor
          target={editing}
          value={element.text}
          onChange={(text) => writeElementText(element.id, text)}
          profile={TEXT_PROFILES.text}
          label={editTextActionLabel(element)}
          describedBy={hintId}
          hint={hinted ? '' : 'Type something'}
          className={hinted ? 'wb-edit-over-hint' : undefined}
        />
      ) : hinted ? null : (
        <RichText text={element.text} profile={TEXT_PROFILES.text} font={font} />
      )}
      {hintId !== undefined ? (
        <span id={hintId} hidden>
          {element.placeholder}
        </span>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------------ */
/* Section                                                                  */
/* ------------------------------------------------------------------------ */

/** How far a zoomed-out title sits above its section, in board pixels at zoom 1. */
const ZOOMED_OUT_TITLE_LIFT = `${containerTitleScaledGap + CONTAINER_TITLE_GAP_SCALED}px`;

/**
 * A section: a tinted frame that groups what is inside it, with its title
 * above the top-left corner. The frame grows to fit what was dropped into
 * it (the layer measures that); the title keeps a readable screen size
 * at any zoom and hides when the section is too narrow on screen.
 */
export const SectionView = memo(function SectionView({ element }: { element: ContainerElement }) {
  const scheme = useColorScheme();
  const item = useItemProps(element);
  const grown = useMeasures((state) => state.measures.get(element.id)?.sectionH);
  const h = Math.max(element.h, grown ?? 0);
  const { w } = element;
  const style: ViewStyle = {
    left: element.x,
    top: element.y,
    width: w,
    height: h,
    ...rotationStyle(element),
    '--wb-fill': sectionFillColor(element.color, scheme),
    '--wb-line': sectionLineColor(element.color, scheme),
    '--wb-ink': sectionInkColor(element.color, scheme),
  };
  return (
    <div {...item} className="wb-el wb-container" style={style}>
      <svg className="wb-shape-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <path d={shapePathData('frame', w, h)} />
      </svg>
      <SectionTitle element={element} />
    </div>
  );
});

/** How far a section title starts from the section's left edge, unscaled (`.wb-container-title`). */
const TITLE_INSET = 4;

/** Scales a section title's node to the zoom imperatively (no re-render on zoom), hiding it where the section is too small for it. */
function useTitleScale(box: RefObject<HTMLDivElement | null>, element: ContainerElement, editing: boolean, shown: boolean): void {
  useEffect(() => {
    const node = box.current;
    if (!node) return undefined;
    const apply = () => {
      const zoom = useCamera.getState().camera.zoom;
      const shown = containerTitleScale(element, currentMeasures(), zoom);
      // Being edited, the title shows whatever the room, without the nested-title cap.
      const scale = editing ? containerTitleScaleForZoom(zoom) : shown;
      node.hidden = scale === undefined;
      node.toggleAttribute('data-zoomed-out', zoom < 1 && scale !== undefined);
      node.style.scale = scale === undefined ? '' : String(scale);
      // Scaled, the title still ends inside the section (it starts at the inset, scaled too).
      node.style.maxWidth = scale === undefined ? '' : `${Math.max(0, element.w / scale - 2 * TITLE_INSET)}px`;
    };
    apply();
    const offCamera = useCamera.subscribe((state, prev) => {
      if (state.camera.zoom !== prev.camera.zoom) apply();
    });
    const offMeasures = useMeasures.subscribe(apply);
    return () => {
      offCamera();
      offMeasures();
    };
  }, [box, element, editing, shown]);
}

/** The title of a section, scaled to the zoom imperatively (no re-render on zoom). */
function SectionTitle({ element }: { element: ContainerElement }) {
  const editing = useEditing(element.id, 'element');
  const featured = useIsFeatured(element.id);
  const asked = useSectionHover((state) => state.id === element.id);
  const picked = useSelection((state) => state.ids.includes(element.id));
  const box = useRef<HTMLDivElement>(null);
  const measure = useMeasureNode<HTMLSpanElement>(element.id, 'title', `${element.text}|${editing !== null}`);
  useTitleScale(box, element, editing !== null, featured || asked);
  const canEdit = maybeSession()?.canEdit ?? false;
  const empty = element.text.trim() === '';
  if (empty && !editing && !((featured || asked) && canEdit)) return null;
  const profile = textProfileForElement(element) ?? TEXT_PROFILES.title;
  return (
    <div ref={box} className={editing ? 'wb-container-title wb-editing' : asked && !picked && !element.locked ? 'wb-container-title wb-glowing' : 'wb-container-title'} dir="auto" style={{ '--wb-title-lift': ZOOMED_OUT_TITLE_LIFT } as ViewStyle}>
      {element.locked ? <Lock className="wb-container-lock" size={12} aria-label="Locked" /> : null}
      <span ref={measure} className="wb-container-title-text">
        {editing ? (
          <TextEditor
            target={editing}
            value={element.text}
            onChange={(text) => writeElementText(element.id, text)}
            profile={profile}
            label={editTextActionLabel(element)}
            hint="Title"
          />
        ) : empty ? (
          <span className="wb-container-hint">Add a title</span>
        ) : (
          <RichText text={element.text} profile={profile} />
        )}
      </span>
    </div>
  );
}
