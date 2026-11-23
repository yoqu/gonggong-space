import { parseRetouchedRecord } from '@open-artifact/motion-core';
import type { FilmSeconds, PlaySeconds, ScoreData } from '@open-artifact/motion-core';
import type { Chapter, NarrationReport, PlayedNarrationLine, StageFilm, StageMeta } from '../protocol.ts';
import { addAssets } from './assets.ts';
import { captionLayer, readNarration } from './captions.ts';
import { errorPhase, failedToLoad, reportError, setErrorPhase, setLateHandler } from './console.ts';
import { chaptersOf, readCut } from './cut.ts';
import type { Cut } from './film.ts';
import { realNow, reseed, setFilmTime } from './determinism.ts';
import { film } from './film.ts';
import { fillStacks, fontFamilies, fontsIn, resetFonts } from './fonts.ts';
import { makeKit } from './kit/index.ts';
import type { Kit } from './kit/index.ts';
import { addModules, findModule, injectScript, setScriptKit, tryScript } from './modules.ts';
import { say } from './port.ts';
import { filmParts, playedScore, plainClock, sceneClock } from './recut.ts';
import type { SceneClock } from './recut.ts';
import { forgetReading } from './layers/scan.ts';
import { takeRecord } from './questions.ts';
import { afterSample, busy, hasPending, isPlaying, onShow, renderAt, renderState, showsAsked, syncClips, unretouched } from './render.ts';
import { noteBox } from './retouch/retouch.ts';
import { recordScore } from './score.ts';
import { scanStage } from './scan.ts';
import { installScenes } from './scenes/install.ts';
import type { HoldFirstDraw } from './snapshot/hold-first-draw.ts';
import { setPlateHold } from './snapshot/plate.ts';
import { sketchScene } from './sketch/pen.ts';
import { buildStage, builtStage } from './stage.ts';
import { tellTexts } from './texts.ts';

const messageOf = (error: unknown): string => String(error instanceof Error ? error.message : error);

let begun = false;

/**
 * Told of each scene's box as it comes up: the classes in it, so a class counts as an element's own alike in every
 * runner. Noted whether or not the film came with the record of what a person did by hand to how things look: the
 * editor's stage is given that after, and may be given one for the first time while it is open.
 */
export function sceneBox(node: HTMLElement): void {
  try {
    noteBox(node);
  } catch {
    unretouched();
  }
}

/**
 * What a person did to the scenes by hand moves what the page is told (length, chapters, score), never what the
 * cut sees. A fault costs their changes, not the film.
 */
function recut(cut: Cut, chapters: readonly Chapter<FilmSeconds>[], ids: readonly string[] | null): SceneClock {
  const record = findModule('recut.json');
  try {
    const clock = sceneClock(filmParts(cut.duration, chapters, ids), record ? record.text : null);
    if (clock.aside) console.info('a person’s scene lengths (modules/recut.json) would take the film past 300 s, so every scene plays at its own length.');
    if (clock.moved)
      console.info(
        'a person changed scene lengths (modules/recut.json): the film plays ' +
          clock.duration +
          ' s, its own time is ' +
          Math.round(cut.duration * 1e6) / 1e6 +
          ' s. Times given to and by this player are as played; render(t) and scenes.json are the film’s own. meta.parts lists both.',
      );
    return clock;
  } catch {
    if (record) console.warn('what a person did to the scenes (modules/recut.json) could not be applied, so the film plays as written.');
    return plainClock(cut.duration);
  }
}

function recordedScore(cut: Cut, kit: Kit): ScoreData | null {
  const write = cut.score;
  if (!write) return null;
  try {
    return recordScore((builder) => {
      write(builder, kit);
    });
  } catch (error) {
    console.error('score(S) threw: ' + messageOf(error));
    return null;
  }
}

function narrationOf(cut: Cut, given: StageFilm, clock: SceneClock): NarrationReport | null {
  const limits = given.narration;
  if (!limits || cut.narration === undefined || cut.narration === null) return null;
  try {
    const read = readNarration(cut.narration, cut.duration, limits);
    if (!read) return null;
    // A line starts on the action it speaks of, so its start moves with the picture; its length is the take's own.
    const lines: PlayedNarrationLine[] = read.lines.map((line) => ({ at: clock.back(line.at), dur: line.dur, text: line.text, audio: line.audio }));
    if (read.captions !== false) film.captions = captionLayer(lines, read.captions.style, Math.min(cut.width, cut.height), fontFamilies.sans);
    return { lines, duck: read.duck };
  } catch (error) {
    film.captions = null;
    console.error('the narration could not be read, so the film plays without it: ' + messageOf(error));
    return null;
  }
}

/**
 * A sample the first frame's draw began: once it has painted, the moment on show is drawn again, unless a frame is on
 * its way or a pull holds the stage, and the clips and the words follow it. After 'ready': the page takes an error
 * before it for a failed load.
 */
function afterReady(sampled: boolean): void {
  const again = afterSample(sampled, onShow, () => !hasPending() && !busy.framing);
  if (!again) return;
  const after = (): void => {
    try {
      if (!hasPending() && !busy.framing && !isPlaying()) void syncClips('hold');
      // The words wait for the page's first render: until then the stage shows moment 0, which it never asked for.
      if (showsAsked()) tellTexts();
    } catch {
      // The next frame does it.
    }
  };
  void again.then((a) => {
    if (a.q)
      a.q.then(after, (error: unknown) => {
        reportError(errorPhase(), error);
        after();
      });
    else after();
  });
}

/** Runs the film's script, builds its stage, records its score and draws its first frame; then says 'ready'. */
export async function loadFilm(given: StageFilm, hold: HoldFirstDraw): Promise<void> {
  if (begun) {
    reportError('load', new Error('already loaded; mount a fresh runner'));
    return;
  }
  begun = true;
  const began = realNow();
  try {
    resetFonts();
    setPlateHold(hold, given.clippedTextWaitMs);
    film.mode = given.mode;
    addAssets(given.assets);
    addModules(given.modules);
    fillStacks(given.faces);
    const kit = makeKit();
    const scenes = installScenes(kit, {
      run: (name, scopedKit, own) => {
        const module = findModule(name);
        return module ? tryScript(module.text, 'module ' + name, scopedKit, own) : new Error('no module ' + name);
      },
      reseed,
      late: setLateHandler,
      now: realNow,
      resetFx: () => builtStage().fxWatch.reset(),
      voice: given.narration !== null,
      box: sceneBox,
      sketch: sketchScene,
      mode: () => film.mode,
    });
    Object.assign(kit, scenes.api);
    setScriptKit(kit);
    film.kit = kit;
    buildStage(1920, 1080, '#ffffff');
    setErrorPhase('load');
    setFilmTime(0 as FilmSeconds);
    Reflect.set(window, 'CUT', undefined);
    injectScript(given.script, 'cut.js');
    // The SyntaxError or throw was reported with its line.
    if (failedToLoad()) return;
    if (builtStage().stage.childNodes.length > 3) console.warn('cut.js built DOM at top level; it is discarded when the stage is sized, so build the scene in init(kit)');
    const cut = readCut(Reflect.get(window, 'CUT'));
    if (typeof cut === 'string') {
      reportError('load', new Error(cut));
      return;
    }
    film.cut = cut;
    const { stage } = buildStage(cut.width, cut.height, cut.background);
    // Fonts are in before init() measures anything.
    await fontsIn();
    if (cut.init) await cut.init(kit);
    try {
      await document.fonts.ready;
    } catch {
      // No font loading API: carry on.
    }
    const painted = getComputedStyle(stage);
    const states = scenes.states();
    const chapters = chaptersOf(cut);
    const score = recordedScore(cut, kit);
    const clock = recut(cut, chapters, states ? states.map((state) => state.id) : null);
    if (clock.moved) film.clock = clock;
    const meta: StageMeta = {
      width: cut.width,
      height: cut.height,
      fps: cut.fps,
      duration: clock.moved ? clock.duration : (cut.duration as PlaySeconds),
      filmDuration: cut.duration as FilmSeconds,
      chapters: chapters.map((chapter) => {
        const part = clock.parts.find((each) => Math.abs(each.a0 - chapter.t) <= 0.05 && each.own === chapter.label);
        return { t: clock.back(chapter.t), label: part ? part.label : chapter.label };
      }),
      scenes: states,
      background: [painted.backgroundColor, painted.backgroundImage],
      parts: clock.parts,
    };
    film.meta = meta;
    // No record clears one: a look may have been tried ahead of the load.
    const looks = findModule('retouched.json');
    takeRecord(looks ? parseRetouchedRecord(looks.text) : null);
    forgetReading();
    const narration = narrationOf(cut, given, clock);
    setErrorPhase('render');
    const sampled = renderState.gavePromise;
    // track() catches this promise's failure, so the window never hears of it: it is reported here.
    renderAt(0 as PlaySeconds)?.then(undefined, (error: unknown) => reportError(errorPhase(), error));
    void syncClips('hold');
    scanStage();
    film.loaded = true;
    say({ type: 'ready', meta, score: score ? playedScore(score, clock) : null, narration, loadMs: Math.round(realNow() - began) });
    afterReady(sampled);
  } catch (error) {
    reportError('load', error);
  }
}
