/**
 * Pieces shared by the fills that may be more than a color (a text fill, a
 * box fill): the Type switch's options, the Image editor of the Custom tab,
 * the closed field's preview of a gradient or picture, and the default
 * gradient a fill starts from.
 */

import { useState, type ReactNode } from 'react';
import { formatBackground, toRgba, type Background, type Gradient } from '@open-artifact/slides-core';
import { toast } from '@open-artifact/ui';
import { formatPicked } from '../../lib/colorspace.ts';
import { pickFiles, uploadImage } from '../../services/assets.ts';
import { Button, Segmented, type Option } from './kit.tsx';

/** What a fill is. */
export type FillKind = 'color' | 'gradient' | 'image';

/** The Type switch of a fill's Custom tab. */
export function fillKindOptions(kinds: readonly FillKind[]): Option<FillKind>[] {
  const labels: Record<FillKind, string> = { color: 'Color', gradient: 'Gradient', image: 'Image' };
  return kinds.map((value) => ({ value, label: labels[value] }));
}

/** What a parsed background is. */
export function fillKindOf(background: Background | null): FillKind {
  return background?.image ? 'image' : background?.gradient ? 'gradient' : 'color';
}

/** The closed field's swatch and label for a gradient or picture fill. */
export function fillPreview(background: Background | null): { swatch: string; label: string } | null {
  if (!background) return null;
  if (background.image) return { swatch: `url("${background.image.url}") center / cover`, label: 'Image' };
  if (background.gradient) return { swatch: formatBackground({ gradient: background.gradient }), label: background.gradient.type === 'radial' ? 'Radial' : 'Linear' };
  return null;
}

/** `from` mixed `t` of the way toward `to`. */
function mix(from: string, to: string, t: number): string {
  const a = toRgba(from) ?? { r: 20, g: 20, b: 19, a: 1 };
  const b = toRgba(to) ?? a;
  return formatPicked({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t), a: 1 });
}

/** The gradient a fill starts from: across, from `color` to a warmer tint of it. */
export function startGradient(color: string | null | undefined): Gradient {
  const from = color && toRgba(color) ? formatPicked({ ...toRgba(color)!, a: 1 }) : '#141413';
  return { type: 'linear', angle: 90, stops: [{ color: from, positions: [] }, { color: mix(from, '#d97757', 0.6), positions: [] }] };
}

/** The Image editor of a fill's Custom tab: choose or replace the picture, and how it sizes. */
export function ImageFillEditor({ image, onImage }: { image: Background['image'] | null; onImage: (next: NonNullable<Background['image']>) => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const choose = (): void => {
    void pickFiles('image/png,image/jpeg,image/webp,image/gif', false).then(async (files) => {
      const file = files[0];
      if (!file) return;
      setBusy(true);
      try {
        const uploaded = await uploadImage(file);
        onImage({ url: uploaded.src, size: image?.size ?? 'cover' });
      } catch (error) {
        toast.add({ title: "Couldn't add the image", description: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2">
        <span className="w-12 shrink-0 text-[12px] text-chrome-muted">Image</span>
        {image ? <span className="size-6 shrink-0 rounded-[4px] bg-cover bg-center shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]" style={{ backgroundImage: `url("${image.url}")` }} /> : null}
        <Button size="sm" className="min-w-0 flex-1" disabled={busy} onClick={choose}>
          {busy ? 'Uploading…' : image ? 'Replace…' : 'Choose image…'}
        </Button>
      </div>
      <div className="flex min-h-7 items-center gap-2">
        <span className="w-12 shrink-0 text-[12px] text-chrome-muted">Size</span>
        <Segmented<'cover' | 'contain'>
          aria-label="Image size"
          value={image?.size ?? 'cover'}
          options={[
            { value: 'cover', label: 'Cover' },
            { value: 'contain', label: 'Contain' },
          ]}
          onChange={(size) => image && onImage({ ...image, size })}
        />
      </div>
    </div>
  );
}
