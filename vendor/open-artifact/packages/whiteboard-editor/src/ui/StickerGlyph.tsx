/**
 * How a sticker's art is drawn, in the picker and on the board:
 *
 * - the face sticker: the placer's avatar (initials on their color);
 * - an icon sticker: its lucide icon in a thick marker stroke;
 * - an emoji (named or bare): Noto's still art (`lib/noto-emoji.ts`); the
 *   animation where Noto animates it only on hover in the picker
 *   (`animate`) and once when the shared timer ends (`play`); the system
 *   emoji font when the art does not load.
 *
 * Each sits on a white die-cut rim (`.wb-sticker-art`) so it reads as a
 * sticker on any background. Sizes follow the font size (`1em` = the art).
 */

import { useState } from 'react';
import { FACE_STICKER_ART, iconStickerOf, isEmojiStickerArt, STICKER_EMOJI } from '@open-artifact/whiteboard-core';
import { notoEmojiArt } from '../lib/noto-emoji.ts';
import { avatarColor, avatarInk, hashString, initialsOf } from '../lib/avatar.ts';
import { stickerIconComponent } from '../lib/sticker-icons.ts';

/** Marker colors icon stickers are drawn in (picked per icon). */
const MARKER_COLORS = ['#e5484d', '#f76b15', '#e2a336', '#30a46c', '#0090ff', '#8e4ec6'] as const;

/** The marker color of an icon sticker. */
export function iconStickerColor(icon: string): string {
  return MARKER_COLORS[hashString(icon) % MARKER_COLORS.length]!;
}

/** Props of {@link StickerGlyph}. */
export interface StickerGlyphProps {
  /** A catalog key or the face art; absent for a bare emoji. */
  art?: string;
  /** The emoji glyph (bare emoji stickers, and the fallback of catalog keys). */
  glyph?: string;
  /** For the face sticker: whose face. */
  who?: { id: string; name: string };
  /** Size in CSS pixels (sets the font size). */
  size: number;
  /** When an animated emoji plays: on hover (the picker) or never (the board: still art). */
  animate?: 'hover' | 'never';
  /** A one-shot animation to show in place of the still art (an object URL; see `lib/sticker-party.ts`). */
  play?: string | undefined;
  className?: string;
}

/** Draws one sticker's art. */
export function StickerGlyph({ art, glyph, who, size, className, animate = 'never', play }: StickerGlyphProps) {
  const style = { fontSize: size, width: size, height: size };
  if (art === FACE_STICKER_ART) {
    const name = who?.name ?? '?';
    const color = avatarColor(who?.id ?? name);
    return (
      <span className={`wb-sticker-art wb-sticker-face ${className ?? ''}`} style={style} aria-hidden="true">
        <span style={{ background: color, color: avatarInk(color) }}>{initialsOf(name)}</span>
      </span>
    );
  }
  const icon = iconStickerOf(art);
  const Icon = icon ? stickerIconComponent(icon.icon) : undefined;
  if (icon && Icon) {
    return (
      <span className={`wb-sticker-art wb-sticker-icon ${className ?? ''}`} style={style} aria-hidden="true">
        <Icon strokeWidth={2.5} absoluteStrokeWidth={false} color={iconStickerColor(icon.icon)} />
      </span>
    );
  }
  const emoji = art !== undefined && isEmojiStickerArt(art) ? STICKER_EMOJI[art] : (glyph ?? icon?.glyph ?? '⭐');
  return <EmojiGlyph emoji={emoji} style={style} animate={animate} play={play} className={className} />;
}

/** An emoji in Noto's art; the system font when the art fails to load. */
function EmojiGlyph({
  emoji,
  style,
  animate,
  play,
  className,
}: {
  emoji: string;
  style: { fontSize: number; width: number; height: number };
  animate: 'hover' | 'never';
  play: string | undefined;
  className: string | undefined;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const art = notoEmojiArt(emoji);
  const hovering = art?.animated !== undefined && animate === 'hover' && hovered;
  const src = art === undefined ? undefined : (play ?? (hovering ? art.animated! : art.svg));
  const hover = animate === 'hover' ? { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) } : {};
  if (src === undefined || failed === src) {
    return (
      <span className={`wb-sticker-art wb-sticker-emoji ${className ?? ''}`} style={style} aria-hidden="true" {...hover}>
        {emoji}
      </span>
    );
  }
  return (
    <span className={`wb-sticker-art wb-sticker-noto ${className ?? ''}`} style={style} aria-hidden="true" {...hover}>
      <img src={src} alt="" draggable={false} decoding="async" onError={() => setFailed(src)} />
    </span>
  );
}
