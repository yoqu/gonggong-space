/**
 * `@open-artifact/whiteboard-core`: the Whiteboard artifact model, shared by
 * the editor page, the type server and agent-side checks. Pure TypeScript,
 * no DOM requirement (helpers that can use a DOM degrade without one, and
 * text measurement is injected).
 */

// The format: schema, limits, normalization and the document codec.
export * from './schema.ts';
export * from './text-limits.ts';
export * from './json.ts';
export * from './normalize.ts';
export * from './derived.ts';
export * from './codec.ts';

// Element content: pictures, links, stickers, tables, the shared timer, inks.
export * from './image-source.ts';
export * from './image-crop.ts';
export * from './links.ts';
export * from './stickers.ts';
export * from './sticker-hosts.ts';
export * from './table.ts';
export * from './table-tints.ts';
export * from './timer.ts';
export * from './inks.ts';
export * from './theme.ts';
export * from './backdrop.ts';

// Geometry and editing.
export * from './geometry.ts';
export * from './snapping.ts';
export * from './hit-test.ts';
export * from './reading-order.ts';
export * from './groups.ts';
export * from './attachments.ts';
export * from './edits.ts';
export * from './layout.ts';
export * from './selection.ts';
export * from './next-item.ts';

// Rendering math: shape outlines, hand-drawn ink, shadows, arrows, drawn SVG, text.
export * from './shape-paths.ts';
export * from './ink.ts';
export * from './shadows.ts';
export * from './arrows/routing.ts';
export * from './arrows/layout.ts';
export * from './arrows/labels.ts';
export * from './arrows/end-snap.ts';
export * from './arrows/bend-drag.ts';
export * from './drawn-svg/xml.ts';
export * from './drawn-svg/svg-geometry.ts';
export * from './drawn-svg/vetting.ts';
export * from './drawn-svg/restyle.ts';
export * from './drawn-svg/contrast.ts';
export * from './drawn-svg/looks.ts';
export * from './text/inline-markdown.ts';
export * from './text/note-markdown.ts';
export * from './text/text-arrows.ts';
export * from './text/markup.ts';
export * from './text/measure.ts';
export * from './text/fit.ts';
export * from './text/links.ts';
export * from './text/placeholder.ts';
export * from './text/push-down.ts';
export * from './text/turned-anchor.ts';

// Collaboration: live sync, undo history, claims, ideas, comments, the view
// context, the clipboard and board files.
export * from './sync/index.ts';
export * from './history.ts';
export * from './version-board.ts';
export * from './claims.ts';
export * from './ideas.ts';
export * from './comment-anchors.ts';
export * from './view-context.ts';
export * from './clipboard.ts';
export * from './board-file.ts';
export * from './check.ts';
