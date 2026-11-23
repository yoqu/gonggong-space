# @open-artifact/editor-kit

What the artifact editors (`design-editor`, `slides-editor`,
`whiteboard-editor`, `design-system-editor`) share beyond the UI primitives of
`@open-artifact/ui`. It is private and is not built on its own: each editor's
Vite build compiles the sources it imports.

The kit holds behavior and views. Each editor keeps its document model and
stores, and connects them to the kit through a small **adapter**: an object of
callbacks the kit calls. The kit never imports an editor.

## Entries

| Import | What | Rules |
|---|---|---|
| `@open-artifact/editor-kit` | Pure modules: stores, controllers, helpers (`src/index.ts`) | `.ts` only. No React views, no `@open-artifact/ui`, lucide or Base UI. Loads in `node --test`. |
| `@open-artifact/editor-kit/react` | The shared views (`src/react.ts`) | May import `@open-artifact/ui`, React, lucide. |
| `@open-artifact/editor-kit/styles.css` | `@source "./"`, so Tailwind scans the kit for class names | Import it after the UI kit's sheet. |

`test/isolation.test.ts` enforces these rules: it checks every import in
`src/`, keeps the pure modules free of views, and loads the pure entry in
node.

## What lives where

Pure entry (`src/`):

| Module | Contents |
|---|---|
| `collab/comments.ts` | `createComments(adapter)`: the comments store and actions (threads, drafts, replies, resolve, send to agent). |
| `collab/history.ts` | `createHistory(adapter)`: the version history store (list, preview, restore, notices). |
| `collab/history-wiring.ts` | `wireVersionHistory`, `readVersionFiles`: history over the `history` capability with a files store. |
| `collab/presence.ts` | `createPresence(adapter)`, peer colors (`PEER_COLORS`, `AGENT_COLOR`, `peerColor`), `peerValue`. |
| `collab/collab.ts` | `createCollab`: the glue between comments, history and the Shell (chrome report, commands, the right-hand panel, Esc and comment-mode keys). |
| `collab/pins.ts` | Camera math for comment pins and cards. |
| `merge.ts` | `mergeLines(base, ours, theirs, { adjacent })`: three-way line merge. `adjacent: 'conflict'` (slides) refuses changes on touching lines; the default `'merge'` (design system) takes both. |
| `find.ts` | `occurrences`, `excerpt`, `stepIndex`, `createFind(adapter)`, `highlightText`, `clearFindHighlights` (CSS Custom Highlight API). |
| `roles.ts` | `roleAbilities(role)`, `readOnlyLabel(role)`. |
| `session.ts` | `connectHost(names)`, `sessionSlot()`, `GUEST_VIEWER`, `artifactPath`, `projectPath`. |
| `shell.ts` | `agentChrome`, `chromeReporter` (deduped reports), `createShellBridge` (a bridge with a React hook for what the Shell draws). |
| `agent.ts` | `agentResultMessage(result, subject)`, `sendFailure`, `watchAgentStatus`. |
| `downloads.ts` | `saveFile` (host downloads, else the browser), `browserDownload`, `browserDownloadUrl`. |
| `design-systems.ts` | `createSystemsLoader(adapter)`: reads installed design systems under `project/ds/` and reloads them when they change. |
| `stash.ts` | `storedJson`, `stashFresh`, `STASH_KEEP_MS`, `normalizeJson`: recovery stashes in `localStorage`. |
| `page-link.ts` | `#page=` links and browser history for pages. |
| `announce.ts` | `announce(message)` for the screen reader live region. |
| `keys.ts` | `isApplePlatform`, `MOD`, `ALT`, `SHIFT`, `modKey`, `isTextField`. |

React entry: `CommentViews` (pins, capture, cards), `CommentList`,
`HistoryViews` (aside, preview bar), `PresenceViews` (avatars, cursors, peer
boxes), `Announcer`, `chrome.tsx` (`ChromeButton`, `ChromeMenu*`, `Card`,
`Tip`, `POPUP`…) and `FindBar`.

Token helpers for installed design systems (`styleDeclarations`, `styleTag`,
`installedKey`, `lengthPx`) live in `@open-artifact/design-system-core`
(`installed.ts`) because they describe the token format, not an editor.

## Adopting a module

1. Add `"@open-artifact/editor-kit": "0.1.0"` to the editor's `dependencies`
   and run `npm install` (the workspace symlink resolves it; no Vite alias is
   needed).
2. In the editor's `styles.css`, after `@import "@open-artifact/ui/styles.css";`,
   add `@import "@open-artifact/editor-kit/styles.css";`. Define the chrome
   tokens the shared views use in the editor's `@theme`: the colors
   `--color-chrome`, `-fg`, `-muted`, `-accent`, `-hover`, `-line`,
   `-pressed`, `-pressed-fg` and `-focus` (the focus outline), and the
   shadows `--shadow-chrome` and `--shadow-chrome-popup`.
3. Write the adapter next to the editor's store, usually in
   `src/services/<module>.ts`, and export what the rest of the editor uses
   from there. Components import views from `/react`.
4. Delete the editor's own copy and its tests; the kit's tests cover the
   shared part. Keep tests for what the adapter adds.

## Adapter contracts

- **`CommentsAdapter<A>`** (`A`: the editor's anchor). Required: `parse`,
  `serialize`, `label`, `canComment`, `canSendToAgent`. Optional: `location`
  (stored for the agent), `state` (`ok`/`moved`/`detached`/`orphaned`),
  `stateNote`, `reveal`, `notify`, `agentName`, `onModeChange`, `noun`,
  `maxThreads`.
- **`HistoryAdapter<P>`** (`P`: a loaded preview). `loadPreview(history, n)`
  reads version `n`; optional `notify` and `noun`.
- **`PresenceAdapter<S>`** (`S`: what the editor publishes besides the
  pointer). `key`, `snapshot`, `parse`, `watch(changed)` (returns an
  unsubscribe), `pointer(event)` (world point or `null`), optional
  `wrotePath`.
- **`createCollab({ comments, history, adapter })`**. `comments` and `history`
  are a kit controller or an editor's own store of the same shape
  (`CollabComments`, `CollabHistory`). `CollabAdapter`: `onSurface`,
  `readOnly`, optional `showSurface`, `commentOnSelection` and `pageButton`.
- **`FindAdapter<M>`** (`M`: a match). `search(query)`, `reveal(match, index,
  count)`, `onClose`, optional `start(matches)` and `noResults`. Stepping
  searches again, so matches follow edits. For highlights, call
  `highlightText(doc, root, query, ownerOf, occurrence)`; `ownerOf(parent)`
  says which element owns a text node (its key and whether it is the current
  match) or `null` to skip it.
- **`SystemsLoaderAdapter<R, S>`**. `artifact()`, `records()`,
  `subscribe(listener)`, `read(record, tokens)` and `loaded(result)`. Call
  `start()` once the session is connected. The loader reloads when the
  installed records change or a copy's `tokens.json` changes, and drops reads
  that a newer reload overtook.
- **Session**. `connectHost(['artifact', 'agent', …])` installs the page
  provider, then connects the user, the named capabilities and the Shell, and
  returns `{ viewer, abilities, shell, ...capabilities }`. Keep the result in
  a `sessionSlot()`.
- **Shell**. Use `chromeReporter(shell, build)` when the editor subscribes
  its own stores and handles commands itself (design, slides, design
  system). Use `createShellBridge(() => shell)` when several modules
  contribute parts of the report and register command handlers
  (whiteboard).
- **Downloads**. `saveFile(downloads, name, blob)` returns `{ to: 'host' }`
  or `{ to: 'browser' }`, so the editor can choose its toast.

## Left in the editors

These look alike but are not shared yet, because they depend on each
editor's document store, file kinds or look:

- `services/sync.ts` (the debounced publish, conflict merge and offline
  retry). The loop has the same shape everywhere, but what is sent, how it is
  acknowledged and when it saves again differ per store.
- Each editor's `systemFromTokens` and recovery banner.
- The whiteboard's chrome, find and announcer, and the slides comments
  service. They have their own views and comment semantics.
- The design system's history and presence, and its markdown, live-props,
  type and comment-anchor helpers. They have no second user yet.

Move one into the kit when a second editor needs the same thing.
