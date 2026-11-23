/**
 * Firefox leaves text filled through `background-clip: text` out of an SVG picture drawn before its 5 ms first-paint
 * timer fires, and keeps that picture. `holdFirstDraw(svg, waitMs, draw)` calls `draw` once a test picture made after
 * `svg` shows its own clipped text, or after `waitMs` (512 by default, 2000 at most, at once unless above 0).
 * Elsewhere it draws at once. Delete once Firefox shows such text in a picture drawn in its onload.
 */
export type HoldFirstDraw = (svg: string, waitMs: number | undefined, draw: () => void) => void;

const atOnce: HoldFirstDraw = (_svg, _waitMs, draw) => draw();

/**
 * Made before the film clock replaces performance.now: it binds the real one, and never calls Math.random.
 * Only Firefox supports -moz-appearance; a Firefox that dropped it would lose such text again.
 */
export function makeHoldFirstDraw(): HoldFirstDraw {
  try {
    if (!CSS.supports('-moz-appearance', 'none')) return atOnce;
    return firefoxHold(performance.now.bind(performance), crypto.getRandomValues.bind(crypto));
  } catch {
    return atOnce;
  }
}

// A canvas that cannot be read counts as inked, so that nothing waits for it.
function inked(picture: HTMLImageElement | null): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return true;
    if (picture) context.drawImage(picture, 0, 0);
    const pixels = context.getImageData(0, 0, 16, 16).data;
    for (let p = 3; p < pixels.length; p += 4) if ((pixels[p] ?? 0) > 64) return true;
    return false;
  } catch {
    return true;
  }
}

// Firefox writes such a background as "padding-box text" once a script has changed the style.
function maySpellSuchAFill(svg: string): boolean {
  return svg.indexOf('-clip') >= 0 || svg.indexOf('-box text') >= 0 || /background\s*:[^;:}"]{0,600}\btext\b/.test(svg);
}

function firefoxHold(now: () => number, random: <T extends ArrayBufferView>(array: T) => T): HoldFirstDraw {
  const wait = setTimeout.bind(self);
  const clear = clearTimeout.bind(self);
  const Picture = Image;
  const Channel = MessageChannel;
  let faked: boolean | undefined;
  let ranOut = 0;

  // Its URL is new each time: Firefox reuses the picture it already made for a URL.
  const testPicture = (then: (picture: HTMLImageElement | null) => void): void => {
    const picture = new Picture();
    const id = random(new Uint32Array(2));
    picture.onload = () => then(picture);
    picture.onerror = () => then(null);
    picture.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" data-n="${id[0]}-${id[1]}"><foreignObject width="16" height="16"><div xmlns="http://www.w3.org/1999/xhtml" style="font:700 16px/16px sans-serif;background:#000;-webkit-background-clip:text;background-clip:text;color:transparent">MM</div></foreignObject></svg>`,
      );
  };

  // Waits by messages to itself: Firefox slows setTimeout to once a second in a hidden tab. It always yields once.
  const turns = (until: number, then: () => void): void => {
    const channel = new Channel();
    channel.port1.onmessage = () => {
      if (now() < until) channel.port2.postMessage(0);
      else {
        channel.port1.close();
        then();
      }
    };
    channel.port2.postMessage(0);
  };

  return (svg, waitMs = 512, draw) => {
    if (!(waitMs > 0) || ranOut >= 3 || !maySpellSuchAFill(svg)) return draw();
    // Reads are faked (privacy.resistFingerprinting): no test picture could be judged.
    if (faked === undefined) faked = inked(null);
    if (faked) return draw();
    const looks = [0];
    const tests: Array<HTMLImageElement | undefined> = [];
    let done = false;
    let guard: ReturnType<typeof setTimeout> | undefined;
    const finish = (showed: boolean): void => {
      if (done) return;
      done = true;
      clear(guard);
      ranOut = showed ? 0 : ranOut + 1;
      draw();
    };
    // Each look reads its own picture: one first drawn too early stays blank.
    const look = (n: number, start: number): void => {
      try {
        turns(start + (looks[n] ?? 0), () => {
          if (done) return;
          if (inked(tests[n] ?? null)) finish(true);
          else if (n + 1 < looks.length) look(n + 1, start);
          else finish(false);
        });
      } catch {
        finish(false);
      }
    };
    try {
      guard = wait(() => finish(false), 4000);
      for (let ms = 8; ms < waitMs && ms < 2000; ms *= 2) looks.push(ms);
      looks.push(Math.min(waitMs, 2000));
      let left = looks.length;
      looks.forEach((_ms, i) => {
        testPicture((picture) => {
          if (!picture) return finish(false);
          tests[i] = picture;
          if (--left === 0) look(0, now());
        });
      });
    } catch {
      finish(false);
    }
  };
}
