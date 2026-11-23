/**
 * `@open-artifact/editor-kit/react`: the views editors share. Every one is
 * driven by a controller from the pure entry (`@open-artifact/editor-kit`)
 * plus props for what differs per editor. Include
 * `@open-artifact/editor-kit/styles.css` so Tailwind sees their classes.
 */
export * from './collab/CommentViews.tsx';
export * from './collab/CommentList.tsx';
export { CommentsLayer, InLayer } from './collab/cds/layer.tsx';
export * from './collab/HistoryViews.tsx';
export * from './collab/PresenceViews.tsx';
export * from './Announcer.tsx';
export * from './chrome.tsx';
export { menuFit } from './menu-fit.ts';
export * from './FindBar.tsx';
export * from './PanelEdge.tsx';
/** Key labels for the chrome's shortcut chips (also in the pure entry). */
export { ALT, MOD, SHIFT } from './keys.ts';
