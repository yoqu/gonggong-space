import type { HostToStage } from '../protocol.ts';
import { captureConsole, catchErrors } from './console.ts';
import { installFilmClock } from './determinism.ts';
import { film } from './film.ts';
import { containFocus, holdLinks, watchNavigation } from './focus.ts';
import { pullFrame } from './frame.ts';
import { loadFilm } from './load.ts';
import { connect } from './port.ts';
import { lookAt, readLayers, tryLook } from './questions.ts';
import { askRender, redraw, showsAsked } from './render.ts';
import { scanStage } from './scan.ts';
import { makeHoldFirstDraw } from './snapshot/hold-first-draw.ts';
import { watchForcedColors } from './snapshot/serialize.ts';
import { fit } from './stage.ts';
import { retell, setTextsGuard, setWatch, tellTexts } from './texts.ts';

// Both are taken before the film clock and the film's own code can replace what they read.
const hold = makeHoldFirstDraw();
watchForcedColors();
installFilmClock();
watchNavigation();
captureConsole();
catchErrors();
containFocus();
holdLinks();
setTextsGuard(showsAsked);

window.addEventListener('resize', () => {
  fit();
  retell();
});

function dispatch(message: HostToStage): void {
  switch (message.type) {
    case 'load':
      void loadFilm(message.film, hold);
      return;
    case 'render':
      askRender({ t: message.t, seq: message.seq, playing: message.playing });
      return;
    case 'mode':
      film.mode = message.mode;
      if (film.loaded) redraw();
      return;
    case 'frame':
      pullFrame(message);
      return;
    case 'watch':
      setWatch(message.on, message.places);
      // Before the page's first render of a load the stage shows moment 0, which it never asked for: that render tells.
      if (showsAsked()) tellTexts();
      return;
    case 'scan':
      scanStage();
      return;
    case 'layers':
      readLayers(message);
      return;
    case 'retouch':
      tryLook(message.record);
      return;
    case 'look':
      lookAt(message);
      return;
    default: {
      const never: never = message;
      void never;
    }
  }
}

connect(dispatch);
