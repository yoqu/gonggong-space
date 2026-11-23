/**
 * The Slides artifact model, shared by the editor, the type server and the
 * command line: the slide HTML subset (compiler and serializer), the deck
 * index and its merges, outline sections, element addressing, immutable
 * edits, view context and whole-project checks.
 */

export * from './limits.ts';
export * from './model.ts';
export * from './icons.ts';
export * from './text.ts';
export * from './video.ts';
export * from './css/color.ts';
export * from './css/values.ts';
export * from './css/properties.ts';
export * from './compile.ts';
export * from './serialize.ts';
export * from './ids.ts';
export * from './edit.ts';
export * from './deck.ts';
export * from './sections.ts';
export * from './templates.ts';
export * from './view-context.ts';
export * from './check.ts';
export * from './css/selectors.ts';
export * from './css/sheet.ts';
export * from './source.ts';
