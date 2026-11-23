/**
 * Views of media elements: pictures (photos in a taped frame, drawings
 * without one), videos and stickers.
 *
 * Uploaded files are stored as `/_blob/<id>`, served from the host's root
 * ({@link resolveAssetUrl}); drawings are restyled to the color
 * scheme's pen. A linked picture opens its link from the arrow in its
 * corner, see {@link PassiveLink}. A video plays on
 * a click of its play button, one at a time (`video-playback.ts`).
 */

import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { ArrowUpRight, Play } from 'lucide-react';
import { FACE_STICKER_ART, IMAGE_FRAME_PADDING, imageCropCss, imageDrawingLook, isSvgBase64DataUrl, stickerLabel, type ColorScheme, type ElementId, type ImageElement, type StickerElement } from '@open-artifact/whiteboard-core';
import { drawnImagePen, drawnImageSrc } from '../export/drawn-svg.ts';
import { isRasterLook } from '../lib/drawing-looks.ts';
import { lookRequestKey, requestDrawingLook, type LookRequest } from '../services/drawing-looks.ts';
import { announce, notify } from '../services/announce.ts';
import { maybeSession } from '../services/session.ts';
import { useCamera } from '../state/camera.ts';
import { useDrawingLooks } from '../state/drawing-looks.ts';
import { usePresence } from '../state/presence.ts';
import { useSelection } from '../state/selection.ts';
import { useColorScheme } from '../state/theme.ts';
import { effectiveTool, useTool } from '../state/tool.ts';
import { useCoarsePointer } from '../ui/hooks.ts';
import { StickerGlyph } from '../ui/StickerGlyph.tsx';
import { useIsFeatured } from './hooks.ts';
import { useStickerPlay } from '../lib/sticker-party.ts';
import { useItemProps } from './item.tsx';
import { boardLinkTarget, linkDisplayUrl, resolveAssetUrl } from './links.ts';
import { PassiveLink } from './PassiveLink.tsx';
import { rotationStyle, type ViewStyle } from './style.ts';
import {
  VIDEO_PLAY_ATTRIBUTE,
  VIDEO_PLAY_BUTTON_PX,
  attachVideoClock,
  runVideoPress,
  stopVideo,
  takeToldStop,
  useVideoPlayback,
  videoPlayButtonSize,
  videoPressAction,
  type VideoPlayMode,
} from './video-playback.ts';

/** Whether a picture is a drawing (shown without a frame). */
function isDrawing(src: string): boolean {
  return isSvgBase64DataUrl(src) || src.startsWith('data:image/svg+xml');
}

/** The painting of a drawing in a textured look, if it has one. */
function textureRequest(element: ImageElement, scheme: ColorScheme, scale: number): LookRequest | undefined {
  const look = imageDrawingLook(element);
  if (look === undefined || !isRasterLook(look)) return undefined;
  return { src: element.src, look, scheme, w: element.w, h: element.h, scale };
}

/**
 * The painted look of a drawing in a textured look, once it is ready; asked
 * for only while `view` is in the viewport.
 */
function usePaintedLook(request: LookRequest | undefined, view: RefObject<HTMLDivElement | null>): string | undefined {
  const key = request === undefined ? undefined : lookRequestKey(request).key;
  const painted = useDrawingLooks((state) => (key === undefined ? undefined : state.painted.get(key)));
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = view.current;
    if (request === undefined || node === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [request === undefined, view]);
  useEffect(() => {
    if (request !== undefined && inView && painted === undefined) void requestDrawingLook(request);
  }, [key, inView, painted]);
  return painted;
}

/* ------------------------------------------------------------------------ */
/* Picture and video                                                        */
/* ------------------------------------------------------------------------ */

/** A picture or video, framed and taped unless it is a drawing; optionally linked. */
export const ImageView = memo(function ImageView({ element }: { element: ImageElement }) {
  const scheme = useColorScheme();
  const item = useItemProps(element);
  const plain = isDrawing(element.src);
  const view = useRef<HTMLDivElement>(null);
  const scale = useDrawingLooks((state) => state.scale);
  const painted = usePaintedLook(plain ? textureRequest(element, scheme, scale) : undefined, view);
  const src = painted ?? (plain ? drawnImageSrc(element, drawnImagePen(scheme)) : resolveAssetUrl(element.src));
  const style: ViewStyle = { left: element.x, top: element.y, width: element.w, height: element.h, ...rotationStyle(element), ...(plain ? {} : { padding: IMAGE_FRAME_PADDING }) };
  const crop = element.crop ? (imageCropCss(element.crop) as ViewStyle) : undefined;
  const media =
    element.video !== undefined ? (
      <BoardVideo id={element.id} src={resolveAssetUrl(element.video)} poster={src} crop={crop} />
    ) : (
      <img src={src} alt="" draggable={false} style={crop} />
    );
  const target = element.href !== undefined ? boardLinkTarget(element.href) : undefined;
  return (
    <div
      {...item}
      ref={view}
      className={plain ? 'wb-el wb-image wb-image-plain' : 'wb-el wb-image'}
      style={style}
      {...(element.video !== undefined ? { onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => watchVideoPress(event, element.id) } : {})}
    >
      <div className="wb-image-clip">{media}</div>
      {plain ? null : (
        <>
          <span className="wb-tape wb-tape-l" aria-hidden="true" />
          <span className="wb-tape wb-tape-r" aria-hidden="true" />
        </>
      )}
      {target !== undefined ? (
        <PassiveLink href={target} link={element.href} className="wb-image-link" aria-label={`Open ${linkDisplayUrl(target)}`}>
          <span className="wb-image-go" data-wb-opens="" aria-hidden="true">
            <ArrowUpRight size={14} />
          </span>
        </PassiveLink>
      ) : null}
    </div>
  );
});

/** Props of {@link BoardVideo}. */
interface BoardVideoProps {
  id: ElementId;
  src: string;
  poster: string;
  crop: ViewStyle | undefined;
}

/** How far a press may move and still be a click on a video, px. */
const VIDEO_CLICK_SLOP = 4;

/**
 * Watches a press on video `id` (in the capture phase, before the press
 * selects it) and, when it is let go in place, plays, pauses or resumes the
 * video as {@link videoPressAction} says. The press still selects and drags
 * the item as usual.
 */
function watchVideoPress(event: ReactPointerEvent<HTMLElement>, id: ElementId): void {
  if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
  const tool = useTool.getState();
  if (effectiveTool(tool) !== 'select' || tool.commentMode) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest('[data-wb-chrome],[data-no-pan],.wb-image-link') !== null) return;
  const selected = useSelection.getState().ids;
  const action = videoPressAction({
    onPlayButton: target.closest(`[${VIDEO_PLAY_ATTRIBUTE}]`) !== null,
    viewer: !(maybeSession()?.canEdit ?? false),
    started: useVideoPlayback.getState().playing === id,
    alone: selected.length === 1 && selected[0] === id,
  });
  if (action === undefined) return;
  const start = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
  const end = (): void => {
    removeEventListener('pointerup', up, true);
    removeEventListener('pointercancel', cancel, true);
  };
  const cancel = (next: PointerEvent): void => {
    if (next.pointerId === start.pointer) end();
  };
  const up = (next: PointerEvent): void => {
    if (next.pointerId !== start.pointer) return;
    end();
    if (Math.hypot(next.clientX - start.x, next.clientY - start.y) > VIDEO_CLICK_SLOP) return;
    // Synchronously, so the video starts inside the gesture (some browsers only play sound then).
    flushSync(() => runVideoPress(id, action));
  };
  addEventListener('pointerup', up, true);
  addEventListener('pointercancel', cancel, true);
}

/**
 * A board video: its first frame (the picture) with a play button. While
 * playing (one video at a time, with sound, looping) the `<video>` covers
 * the picture; stopping removes it, back to the first frame. It stops when
 * it leaves the view, while it is cropped, and when it leaves the board.
 */
function BoardVideo({ id, src, poster, crop }: BoardVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const unmounted = useRef(false);
  const asked = useVideoPlayback((state) => state.playing === id);
  const paused = useVideoPlayback((state) => state.playing === id && state.paused);
  const muted = useVideoPlayback((state) => state.playing === id && state.muted);
  const off = useSelection((state) => state.cropping === id);
  const zoom = useCamera((state) => state.camera.zoom);
  const coarse = useCoarsePointer();
  const viewer = !(maybeSession()?.canEdit ?? false);
  const [frame, setFrame] = useState(0);

  // Leaving the board stops it, without a word.
  useLayoutEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (useVideoPlayback.getState().playing === id) useVideoPlayback.setState({ playing: null, paused: false, muted: false });
    };
  }, [id]);

  // Cropping stops it.
  useEffect(() => {
    if (off) stopVideo(id);
  }, [off, id]);

  // Starting and stopping are announced (unless a stop showed its own notice).
  useEffect(() => {
    if (!asked) return undefined;
    announce('Playing video.');
    return () => {
      const told = takeToldStop();
      if (!told && !unmounted.current) announce('Stopped video.');
    };
  }, [asked]);
  const wasPaused = useRef(paused);
  useEffect(() => {
    if (asked && paused !== wasPaused.current) announce(paused ? 'Paused video.' : 'Playing video.');
    wasPaused.current = paused;
  }, [asked, paused]);

  // Plays, pauses and resumes; a stop leaves the video at its start and lets go of the file.
  useLayoutEffect(() => {
    const video = ref.current;
    if (!asked || !video) return undefined;
    return () => {
      video.pause();
      video.currentTime = 0;
      video.removeAttribute('src');
      video.load();
    };
  }, [asked, src]);
  // The selection bar's controls read and move its clock.
  useLayoutEffect(() => {
    const video = ref.current;
    return asked && video ? attachVideoClock(id, video) : undefined;
  }, [asked, id, src]);
  useLayoutEffect(() => {
    const video = ref.current;
    if (!asked || !video) return;
    video.muted = muted;
    if (paused) video.pause();
    else if (video.paused) void Promise.resolve(video.play()).catch(() => undefined);
  }, [asked, paused, muted, src]);

  // Leaving the view stops it.
  useEffect(() => {
    const node = asked ? ref.current?.closest('.wb-el') : null;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[entries.length - 1]?.isIntersecting === false) stopVideo(id);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [asked, id]);

  // The play button's size follows the video's size on screen.
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    const measure = () => setFrame(Math.min(node.offsetWidth, node.offsetHeight));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const failToLoad = () => {
    stopVideo(id, true);
    notify('This video couldn’t be loaded, so only its still is shown.');
  };
  const mode: VideoPlayMode = asked && !paused ? 'playing' : viewer ? 'sign' : 'pressable';
  const size = videoPlayButtonSize(frame * zoom, coarse && !viewer);
  const side = size !== undefined ? VIDEO_PLAY_BUTTON_PX[size] / zoom : 0;
  return (
    <>
      <img src={poster} alt="" draggable={false} style={crop} />
      {asked ? (
        <video
          ref={ref}
          className="wb-video"
          src={src}
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-label="Video"
          onError={failToLoad}
          style={crop}
        />
      ) : null}
      <div ref={frameRef} className="wb-video-overlay">
        {off || size === undefined ? null : (
          <span className="wb-video-play" aria-hidden="true" {...{ [VIDEO_PLAY_ATTRIBUTE]: mode }} style={{ width: side, height: side }}>
            <Play size={side * 0.44} fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Sticker                                                                  */
/* ------------------------------------------------------------------------ */

/** The name of whoever placed a face sticker: the viewer, a peer, or "Someone". */
function useFaceName(authorId: string | undefined): string {
  const peer = usePresence((state) => (authorId === undefined ? undefined : state.peers.get(authorId)?.name));
  if (authorId === undefined) return 'Someone';
  const viewer = maybeSession()?.viewer;
  return viewer && viewer.id === authorId ? viewer.name : (peer ?? 'Someone');
}

/** A sticker: an emoji, an icon from the catalog, or the face of whoever placed it (a vote). */
export const StickerView = memo(function StickerView({ element }: { element: StickerElement }) {
  const item = useItemProps(element);
  const featured = useIsFeatured(element.id);
  const face = element.art === FACE_STICKER_ART;
  const name = useFaceName(face ? element.authorId : undefined);
  const size = Math.min(element.w, element.h) * 0.78;
  const play = useStickerPlay(element);
  const style: ViewStyle = { left: element.x, top: element.y, width: element.w, height: element.h, ...rotationStyle(element) };
  return (
    <div
      {...item}
      className="wb-el wb-sticker"
      style={style}
      title={face ? name : stickerLabel(element)}
    >
      <StickerGlyph {...(element.art !== undefined ? { art: element.art } : {})} glyph={element.glyph} {...(face ? { who: { id: element.authorId ?? '', name } } : {})} size={size} play={play} />
      {face ? <span className="wb-sr">Placed by {name}</span> : null}
      {face && featured ? (
        <span className="wb-by-chip" data-wb-chrome="" dir="auto" aria-hidden="true">
          {name}
        </span>
      ) : null}
    </div>
  );
});
