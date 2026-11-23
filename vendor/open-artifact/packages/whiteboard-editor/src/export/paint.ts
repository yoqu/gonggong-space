/**
 * Paints a whole board onto a 2D canvas, element by element, the way the
 * board draws it (no DOM capture, so embeds never run and nothing outside
 * the board document leaks in).
 *
 * The picture is a title bar over the board's paper and grid; sections
 * first, then every element in drawing order (each rotated about its box),
 * then section titles on top. Notes keep their tilt and shadow, shapes
 * their outlines, arrows their heads and labels, pictures their frame and
 * tape; embeds and link cards become plain cards with their titles; the
 * shared timer is not drawn.
 */

import {
  ARROW_CIRCLE_RADIUS,
  ARROW_LABEL_HALO_WIDTHS,
  ARROW_STROKE,
  BOARD_THEME_COLORS,
  CONTAINER_TITLE_GAP,
  CONTAINER_TITLE_PADDING_X,
  DARK_CONTRAST_TEXT,
  DARK_THEME_INK,
  DEFAULT_IMAGE_CROP,
  DEFAULT_TEXT_STYLE,
  FACE_STICKER_ART,
  IMAGE_FRAME_PADDING,
  LINK_CARD_SIZE,
  MAX_ELEMENT_SIZE,
  NOTE_AUTHOR_STYLE,
  NOTE_MIN_WIDTH,
  NOTE_SHADOWS,
  SECTION_LINE_WIDTH,
  STICKER_EMOJI,
  TABLE_CELL_PADDING,
  TEXT_LINE_HEIGHT,
  TEXT_PROFILES,
  TEXT_SIZE_STYLES,
  arrowCircleCenter,
  arrowEndBoxes,
  arrowHeads,
  arrowTextKnockouts,
  blockColorHex,
  boardInkColor,
  chipColorOn,
  containerTitleBandHeight,
  containerTitleFontPx,
  containerTitleScaleForZoom,
  contrastTextColorOn,
  cylinderCapPathData,
  defaultChipColor,
  elementLayoutBox,
  elementTurn,
  handDrawnShapeOutline,
  hasRoomForContainerTitle,
  htmlDocumentTitle,
  iconStickerOf,
  imageCropNormalizedViewport,
  inkColorOnFill,
  isEmojiStickerArt,
  isSvgBase64DataUrl,
  layoutBoxResolver,
  linkSubtitle,
  linkTitle,
  measureLabelWords,
  measuredArrowGeometry,
  noteAuthorBottomPadding,
  normalizeArrowLabel,
  placeArrowLabel,
  polygonCornerRadius,
  rotatePointAround,
  roundedPolygonPathData,
  sectionFillColor,
  sectionInkColor,
  sectionLineColor,
  shapeEdgeOverlay,
  shapeFillColor,
  shapeOutlineColor,
  shapePathData,
  shapeStrokePaint,
  shapeTextInsets,
  showsTextPlaceholder,
  singleLineTitleText,
  strokePointsToPath,
  tableCellPaints,
  tableColumnIds,
  tableRowIds,
  textBackdropColors,
  textWithListPrefixes,
  themedInkColor,
  withMeasuredNoteHeights,
  type ArrowElement,
  type ArrowGeometry,
  type BoardElement,
  type Box,
  type ColorScheme,
  type ContainerElement,
  type ElementMeasures,
  type ElementsById,
  type ImageElement,
  type NoteElement,
  type ShapeElement,
  type StickerElement,
  type TableElement,
  type TextElement,
} from '@open-artifact/whiteboard-core';
import { avatarColor, avatarInk, initialsOf } from '../lib/avatar.ts';
import { gridPitchAtZoom } from '../lib/camera.ts';
import { iconStickerColor } from '../ui/StickerGlyph.tsx';
import { emojiArtKey } from '../lib/noto-emoji.ts';
import type { ExportFrame } from './frame.ts';
import {
  EXPORT_CARD_COLORS,
  FACE_STICKER_RING_COLOR,
  SHAPE_EDGE_WIDTH,
  TABLE_LINE_COLORS,
  TABLE_RADIUS,
  arrowEndNeighbor,
  arrowPathData,
  elementInkColor,
  faceStickerRingWidth,
  paperTextColor,
  rectPathData,
  stickerOutlineShadows,
  tableCellShape,
  tableHeadColors,
  tableHeadWeight,
  tableTintDividers,
  textAlignOf,
  type TableCellDividers,
} from './look.ts';
import { clipToRect, drawRasterTextLines, layoutRasterTextLines, traceRoundedRect, type RasterLine, type TextLook } from './raster-text.ts';
import { canvasFontFor, truncateToWidth } from './text-layout.ts';

/** What a board picture is painted from. */
export interface PaintOptions {
  elements: readonly BoardElement[];
  /** The board title, shown in the title bar. */
  title: string;
  measures?: ElementMeasures;
  frame: ExportFrame;
  /** The color scheme the picture is drawn in. */
  scheme: ColorScheme;
  /** Loaded pictures by source. */
  images: ReadonlyMap<string, HTMLImageElement>;
  /** The source each image element draws, by element id (falls back to its `src`). */
  imageSources: ReadonlyMap<string, string>;
  /** Sticker art: rendered icons by lucide icon name, Noto emoji by `emojiArtKey`. */
  icons: ReadonlyMap<string, HTMLImageElement>;
  /** Draw note authors and face sticker colors and initials. */
  showAuthors: boolean;
  /** The display name of a person id (face sticker initials). */
  faceName(personId: string): string | undefined;
}

/** The 2D context the painter draws with. */
type Ctx = CanvasRenderingContext2D;

/** Emoji font stack for emoji stickers. */
const EMOJI_FONT_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", ui-sans-serif, system-ui, sans-serif';
/** Fill of the tape strips holding pictures. */
const TAPE_COLOR = 'rgba(250,243,221,.8)';
/** Share of a sticker's side its icon art covers. */
const ICON_ART_SHARE = 0.88;
/** Share of a sticker's side its Noto emoji art covers (the board's `0.78` em). */
const EMOJI_ART_SHARE = 0.78;

/**
 * Paints the board grid over `area` (board units) for a picture at `scale`:
 * lines at the board's pitch for 100 % zoom (or the zoomed-out pitch when
 * the picture is smaller), every other line faded like on screen, snapped
 * to whole pixels.
 */
export function paintBoardGrid(ctx: Ctx, area: Box, scale: number, scheme: ColorScheme): void {
  const gridZoom = Math.min(1, scale);
  const { pitch, going } = gridPitchAtZoom(gridZoom);
  const spacing = pitch / gridZoom;
  const lineWidth = Math.round(scale / gridZoom) / scale;
  const snapLine = (at: number, origin: number): number => origin + Math.max(0, Math.round((at - lineWidth / 2 - origin) * scale)) / scale;
  ctx.save();
  ctx.fillStyle = BOARD_THEME_COLORS[scheme].grid;
  for (const vertical of [false, true]) {
    const [from, to] = vertical ? [area.x, area.x + area.w] : [area.y, area.y + area.h];
    for (let index = Math.ceil(from / spacing); index * spacing < to; index++) {
      ctx.globalAlpha = index % 2 === 0 ? 1 : going;
      if (vertical) ctx.fillRect(snapLine(index * spacing, area.x), area.y, lineWidth, area.h);
      else ctx.fillRect(area.x, snapLine(index * spacing, area.y), area.w, lineWidth);
    }
  }
  ctx.restore();
}

/** A laid-out table cell. */
interface RasterTableCell {
  shape: ShapeElement;
  head: boolean;
  /** The background of a tinted cell. */
  tint?: string;
  dividers?: TableCellDividers;
  look: TextLook;
  lines: RasterLine[];
}

/** Lays out every cell of a table, and each row's height. */
export function layoutRasterTableCells(ctx: Ctx, table: TableElement, scheme: ColorScheme): { laid: RasterTableCell[][]; heights: number[] } {
  const headColors = tableHeadColors(table, scheme);
  const paints = tableCellPaints(table, scheme);
  const dividers = tableTintDividers(table, paints);
  const laid = tableRowIds(table).map((rowId) =>
    tableColumnIds(table).map((columnId): RasterTableCell => {
      const shape = tableCellShape(table, rowId, columnId);
      const head = shape.hollow !== true;
      const paint = paints[rowId]?.[columnId];
      const style = TEXT_SIZE_STYLES[shape.size ?? 'body'];
      const look: TextLook = {
        px: style.px,
        weight: head ? tableHeadWeight(table) : style.weight,
        bold: style.bold,
        ink: head ? headColors.ink : (paint?.ink ?? paperTextColor(shape, scheme)),
        chip: head ? headColors.chip : paint !== undefined ? chipColorOn(paint.fill) : defaultChipColor(scheme),
      };
      const cellDividers = dividers[rowId]?.[columnId];
      return {
        shape,
        head,
        ...(paint !== undefined ? { tint: paint.fill } : {}),
        ...(cellDividers !== undefined ? { dividers: cellDividers } : {}),
        look,
        lines: layoutRasterTextLines(ctx, shape.text, look, shape.w - 2 * TABLE_CELL_PADDING.padX, textAlignOf(shape)),
      };
    }),
  );
  const heights = laid.map(
    (row) => Math.max(1, ...row.map((cell) => cell.lines.length)) * (row[0]?.look.px ?? 16) * TABLE_CELL_PADDING.line + 2 * TABLE_CELL_PADDING.padY + 1,
  );
  return { laid, heights };
}

/** Everything the per-element painters share. */
interface PaintScope {
  ctx: Ctx;
  options: PaintOptions;
  byId: ElementsById;
  backdrops: ReadonlyMap<string, string>;
  dark: boolean;
  palette: (typeof BOARD_THEME_COLORS)[ColorScheme];
}

/** Paints an arrow: its line (knocked out under text it crosses), heads and label. */
function paintArrow(scope: PaintScope, el: ArrowElement): void {
  const { ctx, options, byId, palette } = scope;
  const line = measuredArrowGeometry(el, byId, options.measures);
  if (!line) return;
  ctx.save();
  ctx.strokeStyle = themedInkColor(el.color, options.scheme);
  ctx.lineWidth = ARROW_STROKE.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (el.dash) ctx.setLineDash([...ARROW_STROKE.dash]);
  const heads = arrowHeads(el);
  ctx.save();
  for (const knockout of arrowTextKnockouts(el, line, byId, options.measures)) ctx.clip(new Path2D(rectPathData(options.frame.board) + rectPathData(knockout)), 'evenodd');
  ctx.stroke(new Path2D(arrowPathData(line, heads)));
  ctx.restore();
  ctx.setLineDash([]);
  const vHead = (tipX: number, tipY: number, fromX: number, fromY: number): void => {
    const dx = tipX - fromX;
    const dy = tipY - fromY;
    const dist = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / dist, dy / dist];
    const [length, wing] = [ARROW_STROKE.head, ARROW_STROKE.head * ARROW_STROKE.wing];
    ctx.beginPath();
    ctx.moveTo(tipX - ux * length - uy * wing, tipY - uy * length + ux * wing);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - ux * length + uy * wing, tipY - uy * length - ux * wing);
    ctx.stroke();
  };
  const circleHead = (tipX: number, tipY: number, fromX: number, fromY: number): void => {
    const dot = arrowCircleCenter(tipX, tipY, fromX, fromY);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, ARROW_CIRCLE_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = palette.paper;
    ctx.fill();
    ctx.stroke();
  };
  const [toNeighbor, fromNeighbor] = [arrowEndNeighbor(line, 'to'), arrowEndNeighbor(line, 'from')];
  if (heads[1] !== 'none') (heads[1] === 'circle' ? circleHead : vHead)(line.x2, line.y2, toNeighbor.x, toNeighbor.y);
  if (heads[0] !== 'none') (heads[0] === 'circle' ? circleHead : vHead)(line.x1, line.y1, fromNeighbor.x, fromNeighbor.y);
  paintArrowLabel(scope, el, line, heads);
  ctx.restore();
}

/** Paints an arrow's label: on a pill when it sits on the line, else with a halo on dark boards. */
function paintArrowLabel(scope: PaintScope, el: ArrowElement, line: ArrowGeometry, heads: ReturnType<typeof arrowHeads>): void {
  const { ctx, options, byId, palette, dark } = scope;
  const label = normalizeArrowLabel(el.label ?? '');
  if (label === '') return;
  ctx.font = canvasFontFor(14);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const placed = placeArrowLabel(
    line,
    heads,
    measureLabelWords(label, (word) => ctx.measureText(word).width),
    arrowEndBoxes(el, byId, layoutBoxResolver(options.measures)),
  );
  const cx = placed.x + placed.w / 2;
  const lineHeight = placed.h / placed.lines.length;
  const top = placed.y + lineHeight / 2;
  if (placed.onLine) {
    ctx.fillStyle = palette.labelPill;
    ctx.fillRect(cx - placed.w / 2 - 6, top - 10, placed.w + 12, 20);
  } else if (dark) {
    ctx.strokeStyle = palette.labelPill;
    for (const width of ARROW_LABEL_HALO_WIDTHS) {
      ctx.lineWidth = width;
      placed.lines.forEach((text, index) => ctx.strokeText(text, cx, top + index * lineHeight));
    }
  }
  ctx.fillStyle = elementInkColor(el, options.scheme);
  placed.lines.forEach((text, index) => ctx.fillText(text, cx, top + index * lineHeight));
  ctx.textAlign = 'left';
}

/** Paints a sticky note: tilted paper with its shadow, author line and text. */
function paintNote(scope: PaintScope, el: NoteElement, turn: number): void {
  const { ctx, options } = scope;
  const showAuthor = el.author !== undefined && options.showAuthors;
  const bottomPad = showAuthor ? noteAuthorBottomPadding : 12;
  const w = Math.max(el.w, NOTE_MIN_WIDTH);
  const look: TextLook = { ...(el.size !== undefined ? TEXT_SIZE_STYLES[el.size] : DEFAULT_TEXT_STYLE), ink: paperTextColor(el, options.scheme), chip: chipColorOn(el.color) };
  const lineHeight = look.px * TEXT_LINE_HEIGHT;
  const lines = layoutRasterTextLines(ctx, el.text, look, w - 32, textAlignOf(el), Math.ceil(MAX_ELEMENT_SIZE / lineHeight));
  const h = Math.max(el.h, 16 + lines.length * lineHeight + bottomPad, options.measures?.get(el.id)?.h ?? 0);
  ctx.save();
  ctx.translate(el.x + w / 2, el.y + h / 2);
  ctx.rotate((el.tilt * Math.PI) / 180);
  const angle = ((el.tilt + turn) * Math.PI) / 180;
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = blockColorHex(el.color);
  for (const shadow of NOTE_SHADOWS[options.scheme]) {
    ctx.shadowColor = shadow.ink;
    ctx.shadowBlur = shadow.blur * options.frame.scale;
    ctx.shadowOffsetX = (shadow.x * Math.cos(angle) - shadow.y * Math.sin(angle)) * options.frame.scale;
    ctx.shadowOffsetY = (shadow.x * Math.sin(angle) + shadow.y * Math.cos(angle)) * options.frame.scale;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.shadowColor = 'transparent';
  if (showAuthor && el.author !== undefined) {
    ctx.save();
    ctx.fillStyle = contrastTextColorOn(el.color);
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.45;
    ctx.font = canvasFontFor(NOTE_AUTHOR_STYLE.px);
    ctx.fillText(
      truncateToWidth(el.author, w - 32, (text) => ctx.measureText(text).width),
      16,
      h - NOTE_AUTHOR_STYLE.up - (NOTE_AUTHOR_STYLE.px * NOTE_AUTHOR_STYLE.line) / 2,
    );
    ctx.restore();
  }
  drawRasterTextLines(ctx, lines, look, 16, 16, lineHeight, { side: textAlignOf(el), w: w - 32, unpicked: el.textAlign === undefined });
  ctx.restore();
}

/** Paints a shape's body: fill, cylinder cap, and hand-drawn stroke or soft edge. */
function paintShapeBody(scope: PaintScope, el: ShapeElement, fill: string): void {
  const { ctx, options } = scope;
  ctx.save();
  ctx.translate(el.x, el.y);
  const stroke = shapeStrokePaint(el, options.scheme);
  const unstroked = stroke === 'none';
  const cap = unstroked && el.hollow !== true ? cylinderCapPathData(el.kind, el.w, el.h) : undefined;
  const outline = new Path2D(shapePathData(el.kind, el.w, el.h));
  ctx.fillStyle = fill;
  if (el.hollow !== true) ctx.fill(outline);
  if (cap !== undefined) {
    ctx.fillStyle = shapeOutlineColor(el);
    ctx.fill(new Path2D(cap));
  }
  if (!unstroked) {
    ctx.fillStyle = stroke;
    ctx.fill(new Path2D(handDrawnShapeOutline(el.kind, el.w, el.h, el.id)));
  } else if (el.hollow !== true) {
    ctx.strokeStyle = fill;
    ctx.lineWidth = polygonCornerRadius(el.kind);
    if (polygonCornerRadius(el.kind) > 0) ctx.stroke(outline);
    const rounded = new Path2D(roundedPolygonPathData(el.kind, el.w, el.h, true));
    ctx.clip(rounded);
    ctx.strokeStyle = shapeEdgeOverlay(fill);
    ctx.lineWidth = 2 * SHAPE_EDGE_WIDTH;
    ctx.stroke(rounded);
  }
  ctx.restore();
}

/** Paints a shape: fill, cylinder cap, hand-drawn stroke or soft edge, and centered text. */
function paintShape(scope: PaintScope, el: ShapeElement): void {
  const { ctx, options } = scope;
  const fill = shapeFillColor(el);
  paintShapeBody(scope, el, fill);
  if (!el.text) return;
  const insets = shapeTextInsets(el.kind, el.w, el.h);
  const box = {
    x: el.x + el.w * insets.left,
    y: el.y + el.h * insets.top,
    w: el.w * (1 - (insets.left + insets.right)),
    h: el.h * (1 - (insets.top + insets.bottom)),
  };
  const look: TextLook = {
    ...(el.size !== undefined ? TEXT_SIZE_STYLES[el.size] : DEFAULT_TEXT_STYLE),
    ink: paperTextColor(el, options.scheme),
    chip: el.hollow === true ? defaultChipColor(options.scheme) : chipColorOn(fill),
  };
  const lineHeight = look.px * TEXT_LINE_HEIGHT;
  const lines = layoutRasterTextLines(ctx, el.text, look, box.w, textAlignOf(el), Math.ceil(box.h / lineHeight));
  ctx.save();
  clipToRect(ctx, box.x, box.y, box.w, box.h);
  drawRasterTextLines(ctx, lines, look, box.x, box.y + Math.max(0, (box.h - lines.length * lineHeight) / 2), lineHeight, { side: textAlignOf(el), w: box.w });
  ctx.restore();
}

/** Paints free text in the ink that reads on whatever is behind it (a placeholder shows only on screen). */
function paintText(scope: PaintScope, el: TextElement): void {
  const { ctx, options, backdrops } = scope;
  if (showsTextPlaceholder(el)) return;
  const backdrop = backdrops.get(el.id);
  const look: TextLook = {
    ...TEXT_SIZE_STYLES[el.size],
    ink: inkColorOnFill(el.color, backdrop, options.scheme),
    chip: backdrop !== undefined ? chipColorOn(backdrop) : defaultChipColor(options.scheme),
  };
  const lines = layoutRasterTextLines(ctx, el.text, look, el.wrap ?? Infinity, textAlignOf(el));
  ctx.save();
  drawRasterTextLines(ctx, lines, look, el.x, el.y, look.px * TEXT_LINE_HEIGHT, {
    side: textAlignOf(el),
    w: el.wrap ?? Math.max(0, ...lines.map((line) => line.w)),
    unpicked: el.textAlign === undefined,
  });
  ctx.restore();
}

/**
 * Draws sticker art with its die-cut rim: the art is stamped far off the
 * picture with shadows that land around its real place, once per rim stamp,
 * then drawn itself. `draw(dx)` draws the art moved `dx` to the left.
 */
function stampStickerArt(scope: PaintScope, el: StickerElement, turn: number, draw: (dx: number) => void): void {
  const { ctx, options, dark } = scope;
  const side = Math.min(el.w, el.h);
  const off = options.frame.board.w + options.frame.board.h + el.w;
  for (const [dx, dy, color] of stickerOutlineShadows(!dark).reverse()) {
    const shift = rotatePointAround({ x: dx * side + off, y: dy * side }, { x: 0, y: 0 }, turn);
    ctx.shadowColor = color;
    ctx.shadowOffsetX = shift.x * options.frame.scale;
    ctx.shadowOffsetY = shift.y * options.frame.scale;
    draw(off);
  }
  ctx.shadowColor = 'transparent';
  draw(0);
}

/** Paints a sticker: a face (avatar disc and initials), a lucide icon or an emoji. */
function paintSticker(scope: PaintScope, el: StickerElement, turn: number): void {
  const { ctx, options } = scope;
  const side = Math.min(el.w, el.h);
  const [cx, cy] = [el.x + el.w / 2, el.y + el.h / 2];
  if (el.art === FACE_STICKER_ART && el.authorId !== undefined) {
    const radius = side / 2;
    ctx.save();
    const rings: Array<[string, number]> = [
      ['#ffffff', 0],
      [options.showAuthors ? avatarColor(el.authorId) : FACE_STICKER_RING_COLOR, faceStickerRingWidth(2 * radius)],
    ];
    for (const [color, inset] of rings) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - inset, 0, 2 * Math.PI);
      ctx.fill();
    }
    const name = options.faceName(el.authorId)?.trim();
    if (options.showAuthors && name) {
      ctx.font = canvasFontFor(radius * 0.72, 500);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = avatarInk(avatarColor(el.authorId));
      ctx.fillText(initialsOf(name), cx, cy + radius * 0.05);
    }
    ctx.restore();
    return;
  }
  const icon = iconStickerOf(el.art);
  if (icon) {
    const art = options.icons.get(icon.icon);
    const size = side * ICON_ART_SHARE;
    ctx.save();
    if (art) stampStickerArt(scope, el, turn, (dx) => ctx.drawImage(art, cx - size / 2 - dx, cy - size / 2, size, size));
    else {
      // The icon could not be rendered: a disc in its marker color on a white rim.
      for (const [color, radius] of [
        ['#ffffff', side / 2],
        [iconStickerColor(icon.icon), size / 2],
      ] as const) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }
  const glyph = (el.art !== undefined && isEmojiStickerArt(el.art) ? STICKER_EMOJI[el.art] : undefined) ?? el.glyph;
  const noto = options.icons.get(emojiArtKey(glyph));
  if (noto) {
    const size = side * EMOJI_ART_SHARE;
    ctx.save();
    stampStickerArt(scope, el, turn, (dx) => ctx.drawImage(noto, cx - size / 2 - dx, cy - size / 2, size, size));
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.font = `${Math.round(side * 0.78)}px ${EMOJI_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = DARK_CONTRAST_TEXT;
  stampStickerArt(scope, el, turn, (dx) => ctx.fillText(glyph, cx - dx, cy + side * 0.04));
  ctx.restore();
}

/** Paints a plain card (embeds, link cards). */
function paintCard(scope: PaintScope, box: Box, radius: number): void {
  const { ctx, dark } = scope;
  [ctx.fillStyle, ctx.strokeStyle] = EXPORT_CARD_COLORS[dark ? 'dark' : 'light'];
  ctx.lineWidth = 1.5;
  traceRoundedRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = dark ? DARK_THEME_INK : DARK_CONTRAST_TEXT;
}

/** Paints a table: paper, header fill, tinted cells, cells and grid lines (in the paper color between tinted cells), rows snapped to whole pixels. */
function paintTable(scope: PaintScope, el: TableElement): void {
  const { ctx, options, palette } = scope;
  const box = elementLayoutBox(el, options.measures);
  if (!box) return;
  const lineColor = TABLE_LINE_COLORS[options.scheme];
  const head = tableHeadColors(el, options.scheme);
  const { laid, heights } = layoutRasterTableCells(ctx, el, options.scheme);
  const { board, scale } = options.frame;
  const snapY = (y: number): number => board.y + Math.round((y - board.y) * scale) / scale;
  const height = snapY(box.y + heights.reduce((sum, rowHeight) => sum + rowHeight, 0)) - box.y;
  ctx.save();
  traceRoundedRect(ctx, box.x, box.y, box.w, height, TABLE_RADIUS);
  ctx.fillStyle = palette.paper;
  ctx.fill();
  ctx.save();
  ctx.clip();
  let y = box.y;
  laid.forEach((row, rowIndex) => {
    let x = box.x;
    const rowBottom = snapY(y + (heights[rowIndex] ?? 0));
    for (const cell of row) {
      const background = cell.head ? head.fill : cell.tint;
      if (background !== undefined) {
        ctx.fillStyle = background;
        ctx.fillRect(x, y, cell.shape.w, rowBottom - y);
      }
      if (cell.dividers?.right) {
        ctx.fillStyle = palette.paper;
        ctx.fillRect(x + cell.shape.w - 1, y, 1, rowBottom - y);
      }
      drawRasterTextLines(ctx, cell.lines, cell.look, x + TABLE_CELL_PADDING.padX, y + TABLE_CELL_PADDING.padY, cell.look.px * TABLE_CELL_PADDING.line, {
        side: textAlignOf(cell.shape),
        w: cell.shape.w - 2 * TABLE_CELL_PADDING.padX,
        unpicked: el.textAlign === undefined,
      });
      x += cell.shape.w;
    }
    y += heights[rowIndex] ?? 0;
    if (rowIndex < laid.length - 1) {
      ctx.fillStyle = lineColor;
      ctx.fillRect(box.x + 1, rowBottom - 1, box.w - 2, 1);
      ctx.fillStyle = palette.paper;
      let cellX = box.x;
      for (const cell of row) {
        if (cell.dividers?.bottom) ctx.fillRect(cellX, rowBottom - 1, cell.shape.w, 1);
        cellX += cell.shape.w;
      }
    }
  });
  ctx.restore();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  traceRoundedRect(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, height - 1, TABLE_RADIUS - 0.5);
  ctx.stroke();
  ctx.restore();
}

/** Paints a picture (white frame, crop, tape) or a drawing (as is, cropped). */
function paintImage(scope: PaintScope, el: ImageElement, turn: number): void {
  const { ctx, options } = scope;
  const img = options.images.get(options.imageSources.get(el.id) ?? el.src);
  const natural = img ? { w: img.naturalWidth, h: img.naturalHeight } : undefined;
  if (isSvgBase64DataUrl(el.src)) {
    if (!img || !natural) return;
    const view = el.crop ? imageCropNormalizedViewport(el, natural, el.crop) : undefined;
    if (view) ctx.drawImage(img, view.x * natural.w, view.y * natural.h, view.w * natural.w, view.h * natural.h, el.x, el.y, el.w, el.h);
    else ctx.drawImage(img, el.x, el.y, el.w, el.h);
    return;
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.2)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = -4 * Math.sin((turn * Math.PI) / 180);
  ctx.shadowOffsetY = 4 * Math.cos((turn * Math.PI) / 180);
  ctx.fillStyle = '#fff';
  ctx.fillRect(el.x, el.y, el.w, el.h);
  ctx.shadowColor = 'transparent';
  if (img && natural && natural.w > 0 && natural.h > 0) {
    const inner = { w: el.w - 2 * IMAGE_FRAME_PADDING, h: el.h - 2 * IMAGE_FRAME_PADDING };
    const view = imageCropNormalizedViewport(inner, natural, el.crop ?? DEFAULT_IMAGE_CROP);
    ctx.drawImage(img, view.x * natural.w, view.y * natural.h, view.w * natural.w, view.h * natural.h, el.x + IMAGE_FRAME_PADDING, el.y + IMAGE_FRAME_PADDING, inner.w, inner.h);
  }
  ctx.fillStyle = TAPE_COLOR;
  for (const [x, angle] of [
    [el.x + 8, -0.66],
    [el.x + el.w - 8, 0.66],
  ] as const) {
    ctx.save();
    ctx.translate(x, el.y);
    ctx.rotate(angle);
    ctx.fillRect(-23, -9, 46, 18);
    ctx.restore();
  }
  ctx.restore();
}

/** Paints one element (already rotated). */
function paintElement(scope: PaintScope, el: BoardElement, turn: number): void {
  const { ctx, options } = scope;
  switch (el.type) {
    case 'container':
    case 'timer':
      return;
    case 'arrow':
      return paintArrow(scope, el);
    case 'note':
      return paintNote(scope, el, turn);
    case 'shape':
      return paintShape(scope, el);
    case 'text':
      return paintText(scope, el);
    case 'stroke': {
      ctx.save();
      ctx.translate(el.x, el.y);
      ctx.globalAlpha = scope.dark ? 0.95 : 0.92;
      if (!scope.dark) ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = themedInkColor(el.color, options.scheme);
      ctx.lineWidth = el.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(strokePointsToPath(el.points)));
      ctx.restore();
      return;
    }
    case 'sticker':
      return paintSticker(scope, el, turn);
    case 'html': {
      ctx.save();
      paintCard(scope, el, 10);
      ctx.font = canvasFontFor(13, 500);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(htmlDocumentTitle(el.html) ?? 'Embed', el.x + el.w / 2, el.y + el.h / 2, Math.max(0, el.w - 24));
      ctx.restore();
      return;
    }
    case 'link': {
      const { w, h } = LINK_CARD_SIZE;
      ctx.save();
      paintCard(scope, { x: el.x, y: el.y, w, h }, 12);
      ctx.textBaseline = 'middle';
      const measure = (text: string): number => ctx.measureText(text).width;
      ctx.font = canvasFontFor(14, 600);
      ctx.fillText(truncateToWidth(linkTitle(el), w - 32, measure), el.x + 16, el.y + 20);
      ctx.font = canvasFontFor(11.5, 400);
      ctx.globalAlpha = 0.6;
      ctx.fillText(truncateToWidth(linkSubtitle(el), w - 32, measure), el.x + 16, el.y + 38);
      ctx.restore();
      return;
    }
    case 'table':
      return paintTable(scope, el);
    case 'image':
      return paintImage(scope, el, turn);
  }
}

/**
 * Where a section title is drawn, in board units: its scale, how far the
 * bottom of its line sits above the section, and how far its text starts
 * from the section's left edge.
 */
interface SectionTitleSpot {
  scale: number;
  gap: number;
  inset: number;
}

/** Paints a section's title above it at a title scale, on a halo of paper. */
function paintSectionTitle(scope: PaintScope, el: ContainerElement, spot: SectionTitleSpot): void {
  const { ctx, options, palette } = scope;
  const { scale, gap, inset } = spot;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([]);
  ctx.font = canvasFontFor(containerTitleFontPx);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const padX = (CONTAINER_TITLE_PADDING_X / 2) * scale;
  const title = truncateToWidth(singleLineTitleText(textWithListPrefixes(el.text, TEXT_PROFILES.title)), el.w - inset - padX, (text) => ctx.measureText(text).width * scale);
  if (title !== '') {
    ctx.translate(el.x + inset, el.y - gap - ((containerTitleBandHeight - CONTAINER_TITLE_GAP) / 2) * scale);
    ctx.scale(scale, scale);
    ctx.strokeStyle = palette.labelPill;
    ctx.lineWidth = 3 / scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(title, 0, 0);
    ctx.fillStyle = sectionInkColor(el.color, options.scheme);
    ctx.fillText(title, 0, 0);
  }
  ctx.restore();
}

/** Paints section titles above their sections. */
function paintSectionTitles(scope: PaintScope): void {
  for (const el of scope.options.elements) {
    if (el.type !== 'container' || el.text.trim() === '' || !hasRoomForContainerTitle(el, 1)) continue;
    const scale = containerTitleScaleForZoom(1);
    paintSectionTitle(scope, el, { scale, gap: CONTAINER_TITLE_GAP * scale, inset: CONTAINER_TITLE_PADDING_X * scale });
  }
}

/** Paints the board picture onto a new canvas of the frame's size. */
export function drawBoardCanvas(options: PaintOptions): HTMLCanvasElement {
  const { elements, frame, scheme, measures } = options;
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the board picture.');
  const palette = BOARD_THEME_COLORS[scheme];
  const scope: PaintScope = {
    ctx,
    options,
    byId: new Map(elements.map((element) => [element.id, element])),
    backdrops: textBackdropColors(withMeasuredNoteHeights(elements, measures), measures, scheme),
    dark: scheme === 'dark',
    palette,
  };

  // Title bar.
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.fillStyle = boardInkColor(scheme);
  ctx.font = canvasFontFor(24, 600);
  ctx.textBaseline = 'middle';
  ctx.fillText(options.title || 'Whiteboard', 24, frame.titleBar / 2, frame.width - 48);
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, frame.titleBar - 0.5);
  ctx.lineTo(frame.width, frame.titleBar - 0.5);
  ctx.stroke();

  // The board.
  ctx.save();
  ctx.translate(0, frame.titleBar);
  ctx.scale(frame.scale, frame.scale);
  ctx.translate(-frame.board.x, -frame.board.y);
  paintBoardGrid(ctx, frame.board, frame.scale, scheme);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const el of elements) {
    if (el.type !== 'container') continue;
    const box = elementLayoutBox(el, measures);
    ctx.save();
    ctx.translate(el.x, el.y);
    const outline = new Path2D(shapePathData('frame', el.w, box?.h ?? el.h));
    ctx.fillStyle = sectionFillColor(el.color, scheme);
    ctx.fill(outline);
    ctx.strokeStyle = sectionLineColor(el.color, scheme);
    ctx.lineWidth = SECTION_LINE_WIDTH;
    ctx.stroke(outline);
    ctx.restore();
  }
  for (const el of elements) {
    const turn = elementTurn(el);
    const box = elementLayoutBox(el, measures);
    const rotated = turn !== 0 && box !== undefined;
    if (rotated) {
      ctx.save();
      ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
      ctx.rotate((turn * Math.PI) / 180);
      ctx.translate(-box.x - box.w / 2, -box.y - box.h / 2);
    }
    paintElement(scope, el, turn);
    if (rotated) ctx.restore();
  }
  paintSectionTitles(scope);
  ctx.restore();
  return canvas;
}

/** Encodes a canvas as a PNG. Rejects when the browser cannot encode it. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The board picture could not be encoded.'))), 'image/png');
  });
}
