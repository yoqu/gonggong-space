/**
 * How a snapshot's SVG picture is drawn at w × h. Shared by the stage (plates) and an export's raster frame.
 * Resolves with a canvas or an ImageBitmap; given a canvas to draw in, always with an ImageBitmap.
 */
export type SnapshotSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
export type SnapshotSurface = HTMLCanvasElement | ImageBitmap;
type Way = 'plain' | 'bitmap';

function drawPlain(source: SnapshotSource, w: number, h: number, into?: HTMLCanvasElement | null): HTMLCanvasElement | Promise<ImageBitmap> {
  const canvas = into ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.drawImage(source, 0, 0, w, h);
  // A lost context ignores draws until the browser restores it; the caller's catch then takes a new canvas.
  if (into && context.isContextLost()) throw new Error('canvas context lost');
  // createImageBitmap copies the canvas now, so frames that share it cannot get each other's picture.
  return into ? createImageBitmap(canvas) : canvas;
}

const drawBitmap = (source: SnapshotSource, w: number, h: number): Promise<ImageBitmap> =>
  createImageBitmap(source, { resizeWidth: w, resizeHeight: h });

/*
 * The test scene, 16 × 12: an opaque box and, two bands down, a bare one, each with a hard shadow 8 px to its right.
 * Redrawn right at 32 × 24 it is opaque or clear on both sides of every upright edge of rows 4, 12 and 20.
 */
const SCENE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><foreignObject width="16" height="12"><div xmlns="http://www.w3.org/1999/xhtml">' +
  '<div style="width:4px;height:4px;background:#000;box-shadow:8px 0 0 #000"></div><div style="width:4px;height:4px;margin-top:4px;box-shadow:8px 0 0 #000"></div></div></foreignObject></svg>';
const RIGHT = '11001100' + '00000000' + '00001100';

function drawsRight(picture: SnapshotSurface): boolean {
  if (picture.width !== 32 || picture.height !== 24) return false;
  const copy = drawPlain(picture, 32, 24);
  if (!(copy instanceof HTMLCanvasElement)) return false;
  const pixels = copy.getContext('2d')?.getImageData(0, 0, 32, 24).data;
  if (!pixels) return false;
  for (let i = 0; i < 24; i++) {
    const alpha = pixels[((4 + 8 * (i >> 3)) * 32 + 8 * ((i & 7) >> 1) + 7 * (i & 1)) * 4 + 3] ?? 0;
    if (RIGHT.charAt(i) === '1' ? alpha < 224 : alpha > 31) return false;
  }
  return true;
}

function transfers(bitmap: ImageBitmap): boolean {
  const channel = new MessageChannel();
  try {
    channel.port1.postMessage(bitmap, [bitmap]);
    return true;
  } catch {
    return false;
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
}

// WebKit is told apart by a CSS property only it has; a WebKit that dropped it keeps the plain draw.
function isWebKit(): boolean {
  try {
    return CSS.supports('-webkit-nbsp-mode', 'space');
  } catch {
    return false;
  }
}

let chosen: Promise<Way> | null = null;

/**
 * WebKit's canvas leaves CSS shadows' offset and blur unscaled when it draws an SVG at another size, so there the
 * picture is resized by createImageBitmap, if that draws the test scene right. Other engines must not try it:
 * Chromium's bitmap cannot be posted.
 */
function pickWay(): Promise<Way> {
  if (chosen) return chosen;
  chosen = !isWebKit()
    ? Promise.resolve<Way>('plain')
    : new Promise<Way>((done) => {
        const scene = new Image();
        scene.onerror = () => done('plain');
        scene.onload = () => {
          new Promise<ImageBitmap | null>((next) => {
            const plain = drawPlain(scene, 32, 24);
            next(plain instanceof HTMLCanvasElement && drawsRight(plain) ? null : drawBitmap(scene, 32, 24));
          })
            .then((bitmap) => {
              let good = false;
              try {
                good = bitmap !== null && drawsRight(bitmap) && transfers(bitmap);
              } finally {
                if (bitmap !== null && !good) bitmap.close();
              }
              done(good ? 'bitmap' : 'plain');
            })
            .catch(() => done('plain'));
        };
        scene.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SCENE);
      });
  return chosen;
}

/** The catch sees a refusal, or a given canvas that is lost or cannot be copied: it draws in a new one. */
export function drawSnapshot(picture: SnapshotSource, w: number, h: number, into?: HTMLCanvasElement | null): Promise<SnapshotSurface> {
  return pickWay()
    .then((way): SnapshotSurface | Promise<SnapshotSurface> => (way === 'bitmap' ? drawBitmap(picture, w, h) : drawPlain(picture, w, h, into)))
    .catch((): SnapshotSurface | Promise<SnapshotSurface> => drawPlain(picture, w, h, into ? document.createElement('canvas') : null));
}

/**
 * Ends an error message: why the text does not parse as XML, in this browser's parser's words (120 characters at
 * most), or '' when it parses, the parser throws, or the text is so long that asking would be slow. Firefox puts
 * the page's address among its words; it is left out.
 */
export function whyNoDecode(svg: string): string {
  try {
    const said = svg.length > 1e6 ? null : new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror')[0];
    if (!said) return '';
    const words = ((said.querySelector('div') ?? said.firstChild ?? said).textContent ?? '')
      .replace(/\s+/g, ' ')
      .replace(/ Location: \S+/, '')
      .trim()
      .replace(/:$/, '');
    return (
      ': written out as XML to be drawn, it does not parse. The browser says, counting in that XML and not in the film’s code: ' +
      (words.length > 120 ? words.slice(0, 119) + '…' : words)
    );
  } catch {
    return '';
  }
}
