# motion-editor

The Video page: the film player, its timeline and toolbar, comments and agent requests. Built by Vite into
`dist/server/editors/video` (`node scripts/build.mjs --only editors`).

## Folders

| Folder | What |
|---|---|
| `src/app/` | `start.ts` boots everything (`bootVideoApp`, `useAppPhase`); `view-context.ts` publishes the view context to room presence (pure shape in `view-shape.ts`). |
| `src/host/` | Session (`connectHost`), Shell bridge, live sync of the film's documents (`live-film.ts`), asset bytes and URLs, the agent's activity, page fonts and the fetched-fonts store (`fonts.ts`), `boot.ts`. The inline view (`#view-inline`): `display-mode.ts` reads it, `view-only.ts` is the read-only host the session runs on then. |
| `src/engine/` | No React. `FilmEngine` (store → records applied → faces → stage), `StageController` (iframe and port), `PlaybackLoop` (rAF, sound clock, render gate), sound loading, `ThumbnailCache`, `actions.ts` (play, seek…), records (`applied-film.ts`, `film-faces.ts`, `retyped-upkeep.ts`, `ended-lines.ts`), undo (`undo.ts`, `undo-stack.ts`, `undo-keys.ts`). |
| `src/stores/` | Zustand stores (below). |
| `src/player/` | `StageView` (letterboxed picture, overlay seam), covers (`FilmStates`), `WorkingBar` (with the time-left estimate from `work-estimate.ts`), `ComingScene`, `EndedOffers`, `Notices`. |
| `src/transport/` | The bottom toolbar, time formats, full screen, the toolbar slot registry. |
| `src/timeline/` | Scrub track, scene strip with stills, scene menu, lanes and scene-edge seams. |
| `src/comments/` | editor-kit comments with video anchors, the layer over the picture, timeline marks, comment keys. |
| `src/agent/` | Requests to the agent (`agent.send`, else the clipboard). |
| `src/keyboard/` | One shortcut registry, its window listener, the playback shortcuts. |
| `src/panels/` | Side panel registry, its grouping into tabs (`panel-view.ts`), its renderer (`SidePanel.tsx`) and the compact inspector mark (`inspector.ts`). |

Each area keeps its user-facing text in its own `words.ts`.

## Stores

- `useFilm` (`stores/film.ts`): `film`, `revision`, `problems`, `hasScript`, `scenes`, `records`, `stage`
  (`idle|loading|ready|error`), `meta` (the stage's `ready.meta`), `clock`, `stageProblem`, `console`, `loadMs`.
  Selectors: `selectDuration`, `selectFps`, `selectParts`, `selectChapters`, `selectSceneReports`. Written by the engine.
- `usePlayback`: `playing`, `time` (seconds as played), `rate`, `loop`, `muted`, `volume`, `buffering`, `ended`,
  `soundAvailable`. Change it through `engine/actions.ts`, not directly.
- `useUi`: `panel`, `lastPanel`, `focus`, `fullscreen`, `playerSize`, `stageBox`, `hoverTime`, `notices`;
  `openPanel`, `setFocus`, `addNotice`, `dismissNotice`.
- `useWorking`: `activity`, `available`, `name`, `wakesIdle`, `asked`, `lastFilmWriteAt`, `sync`, `readOnlyReason`,
  `canAsk`; `setAsked`.
- Comments: `useComments` (editor-kit's `CommentsState<VideoAnchor>`), `useRangeMark` (`from`).

## Engine API

`filmEngine()` gives the running `FilmEngine`: `stage` (`StageController`), `sound`, `playback`, `thumbnails`;
`start()`, `attach(el)`, `detach(el)`, `setMode('rough'|'final')`, `send(HostToStage)`, `onStageMessage(fn)`,
`onFilmLoad(fn)` (each `FilmLoad {stageFilm, missingFonts}` as built), `onSoundLoad(fn)` (each `FilmSoundInput` given
to the sound player: the score, then the narration), `stageFilm` (the last built), `holdLoads()` (keeps new films off
the stage until let go; the release loads the newest and says so) and `holdsLoads`, `pullFrame(t, scale)`, `reload()`,
`dispose()`. `stage.pullFrame` rejects with `StageFrameError {hold, env}` or `StageGoneError`
(`engine/frame-errors.ts`). Pixels of a snapshot (palette probes, flash checks) come from `snapshotPixels`
(`engine/snapshot-pixels.ts`), over motion-export's shared `createRasterHost`. Playback: `play`, `pause`, `togglePlay`, `seekTo`, `seekBy`, `restart`,
`stepFrames`, `setLoop`, `setMuted`, `toggleMuted`, `setVolume`, `setRate` in `engine/actions.ts`. Writes to the film:
`writeFilmDocument(path, data)` in `host/live-film.ts`.

### What the stage loads

`FilmEngine#load` builds the stage's code in this order:

1. `applyFilmRecords` (`engine/applied-film.ts`) rewrites the source: retyped lines (core `applyRetyped`), then
   recolored colors (core `applyRecolored`, also the scenes.json background). A failure becomes a console warning and
   leaves the code as it was.
2. `filmStageFaces` (`engine/film-faces.ts`) makes `StageFilm.faces`. It runs core `prepareFilmFonts` when the film
   asks for a family that is not built in (or has `fetched-fonts.json`), then `buildFilmFaces` → `usableFontFaces`.
   Faces carry data URIs (built-in woff2 files that Vite emits, or fetched/stored bytes). Refaced picks apply
   unless the built-in faces cannot cover the text.
3. When `prepared.store` is set, `host/fonts.ts` stores the fetched fonts: it uploads each licensed family's woff2
   as an asset, then writes `modules/fetched-fonts.json`. This happens once at a time, only when the person can edit,
   after the agent is idle, with a cooldown after a write, and not when `isFontStoreUnchanged`. Faces that arrive late
   (`prepared.late`) reload the film once.
4. `retouched.json` is not part of the stage's modules; it goes in the `retouch {record}` message on decode and on
   ready. The `layers {at}` message belongs to LAYERS.

`startRetypedUpkeep` (`engine/retyped-upkeep.ts`, started with a session) has two jobs:
- It prunes `retyped.json` lines that no longer match the film, after `WORKING_SETTINGS.unsaidAfterS`, but only while
  nothing is pending, the page is visible and the agent is idle.
- It watches film changes around an agent turn (`ended-lines.ts`). When a turn rewrote lines the person had
  retyped, it shows the Notice `ended-text`, whose action sends `endedTextRequest` to the agent.

## Adding things

- **Panel**: `registerPanel({id, label, order, render, when?(film), keepMounted?})` (`panels/registry.ts`); open
  with `togglePanel(id)`. `tweaks` and `style` show as the Properties and Theme tabs of one panel
  (`PROPERTIES_AND_THEME` in `panels/panel-view.ts`); a panel whose `when` is false is hidden. A tab that comes and
  goes says what it has with `reportPanelContent(id, 'has'|'wait'|'none')`: Theme is listed while it has something,
  kept while open and waiting, and gives way to Properties when it has nothing. The panel uses the compact inspector
  layout: `panels/inspector.ts` marks the root with `data-inspector-v1` and
  `styles.css` tightens the shared fields, tabs and sections through their `data-ui-*` hooks.
- **Picking layers**: a press away from the picture, the side panel and any control lets the pick go
  (`layers/press-away.ts`), as Esc does.
- **Feature**: an `install<Name>()` returning its stop function, called at the `FEATURES:` mark in `app/start.ts`.
- **Undo**: `pushUndo({label, undo, redo})` (`engine/undo.ts`) after a change is made. Mod+Z undoes and
  Mod+Shift+Z or Mod+Y redoes, outside text fields, with a toast like "Undid: label". `useUndo` holds
  `canUndo`/`canRedo`. Shown inline the keys are not registered: they stay the host's.
- **Toolbar button**: `registerToolbarItem({id, side: 'start'|'end', order: TOOLBAR_ORDER.<name>, render})`
  (`transport/slots.ts`); Properties 10, Theme 20, Layers 30, Export 40, Comments 50.
- **Layer over the picture**: `registerStageOverlay({id, order, render({box, scale, filmWidth, filmHeight})})`.
- **Timeline lane / recut handles**: `registerTimelineLane({id, order, height, render})`, `setSceneEdge(fn)`.
- **Scene menu item**: `registerSceneMenuItem({id, order: SCENE_MENU_ORDER.<name>, writes?, render({span, showDialog})})`
  (`timeline/scene-menu.ts`); Properties adds Name 10, Length 20, Speed 30. `writes` items hide while read-only; a dialog
  goes through `showDialog(close => …)` so it outlives the menu.
- **Shortcut**: `shortcuts.register({id, keys, label, when?, repeats?, everywhere?, run})`; the latest registered wins,
  so a mode's keys (with `when`) override playback's while it is on.

## Testing

`node --test packages/motion-editor/test/*.test.ts` (pure logic only). `npx tsc -p tsconfig.json` at the root.
Outside a host, the built page (`npx vite preview`) shows "Live sync is unavailable here".

### Full-host smoke test

From the repo root, with `S` set to a scratch folder and `CLI="node dist/server/cli.mjs"`:

1. Build: `node scripts/build.mjs --only cli`, then `npx vite build` in this package (it writes
   `dist/server/editors/motion`).
2. Open a new film:
   ```
   OPEN_ARTIFACT_TYPE_SERVER_HOME=$S/state OPEN_ARTIFACT_USER=Smoke $CLI open $S/film --type motion --json
   ```
   It prints the page URL. Every later command uses the same `OPEN_ARTIFACT_TYPE_SERVER_HOME`.
3. Write a two-scene film (`artifact-types/motion/reference/rough-cut.md`) with `$CLI write-db $S/film writes.json`,
   where `writes.json` is `[{op:'set', path, data}…]`:
   - `film/meta` is `{v:1, title, updatedAt}`.
   - `modules/scenes.json` is `{kind:'json', text}`, where `text` is the JSON of
     `{v:1, stage:'rough', width:1920, height:1080, fps:30, background, fonts:{display:'space-grotesk', sans:'manrope'}, scenes:[{id:'hello', name, dur:3, desc}, {id:'bye', …}]}`.
   - `modules/base.css` is `{kind:'css', text}`.
   - `modules/scene-hello.js` and `modules/scene-bye.js` are `{kind:'js', text}`, each calling
     `kit.scene(id, {init(kit){ kit.stage.append(kit.h('…')) }, render(t){…}})`.
   - `film/script` is `{code:'window.CUT = kit.scenes();'}`.
4. Open the URL in the browser pane. The film plays, both scene cards have stills, and the built-in woff2 fonts load.
   If the pane is hidden, rAF may not run, so read the page as text and the console instead of relying on screenshots.
5. Blob: run `$CLI upload $S/film mark.png` (it prints `/_blob/<id>`). Write `assets/mark.png` =
   `{ref:'/_blob/<id>', mime:'image/png', w, h}`, and a scene that uses `kit.assets.url('mark.png')` in an `<img>`.
   The image shows in the picture and in the stills.
6. Records: `write-db` refuses page-only records, so write them as files:
   - `$S/film/db/modules/<name>.json.json` = `{"kind":"json","text":"<record JSON>"}`;
   - `retyped.json` text: `{"v":1,"lines":[{"was":"…","v":"…"}]}`;
   - `recolored.json`: `{"v":1,"colors":[{"was":"#7A4B2A","v":"#2255CC"}]}`;
   - `refaced.json`: `{"v":1,"display":"fraunces-display"}` (slots at the top level).

   The page picks these up within a few seconds. Then `$S/film/_agent/view-context.json` lists them under
   `handEditRecords`.
7. Fetched fonts: set the scenes.json `fonts.sans` to `{family:'Lora', or:'fraunces'}`. The page POSTs one
   `_api/assets?name=font.woff2` per family, then writes `modules/fetched-fonts.json` with the family, licence and
   notice. Reloading must not upload again.
8. Comments:
   - Press `c` and click the picture, type, then Enter. `$CLI comments $S/film` lists the thread with its time and point.
   - `$CLI comment-reply $S/film <thread> "Thanks"` shows on the page within a few seconds.
   - Escape closes the popover; a second Escape leaves comment mode.
9. Inline view: on the open page, add an `<iframe>` whose `src` is the page URL plus `#view-inline`. In the frame,
   `<html>` has `data-display-inline`, `openartifact.use('user')` answers role `viewer`, a `db.write` rejects with
   `not_granted`, `comments`, `agent`, `room`, `assets` and `downloads` are `null`, there is no Comments button, Mod+Z
   is not taken, and a CLI `write-db` still shows. The top-level page, even with `#view-inline` on its address, edits
   as before.
10. Stop: `OPEN_ARTIFACT_TYPE_SERVER_HOME=$S/state $CLI stop`.
