/**
 * Icons of the properties panel that lucide has no match for: the type
 * scale, line height and letter spacing glyphs, per-side and per-corner
 * toggles and their side / corner markers, and the border stroke styles.
 *
 * They are 16px line icons drawn with `currentColor`, sized by the caller
 * like lucide icons (`size-4` by default).
 */

import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** A 16 × 16 stroked icon. */
function Icon({ children, ...rest }: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

/** A small and a large T: the type scale (text styles, contrast chip). */
export function TypeScaleIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props} strokeWidth={1.2}>
      <path d="M1.5 7H6.5M4 7V13" />
      <path d="M7.5 3.5H14.5M11 3.5V13" />
    </Icon>
  );
}

/** Line height: lines with a double arrow beside them. */
export function LineHeightIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props}>
      <path d="M3.5 2.5V13.5M2 4L3.5 2.5L5 4M2 12L3.5 13.5L5 12" />
      <path d="M7.5 4H14M7.5 8H14M7.5 12H14" />
    </Icon>
  );
}

/** Letter spacing: an A between two bars. */
export function LetterSpacingIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props}>
      <path d="M2 2.5V13.5M14 2.5V13.5" />
      <path d="M5.25 11.5L8 4.5L10.75 11.5M6.2 9H9.8" />
    </Icon>
  );
}

/** Four side ticks: edit a value per side. */
export function SidesIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props}>
      <path d="M5.327 2.655H10.673M5.327 13.345H10.673M2.655 5.328V10.673M13.345 5.328V10.673" />
    </Icon>
  );
}

/** Four corner arcs: edit a radius per corner. */
export function CornersIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props}>
      <path d="M2.739 5.826V4.739C2.739 3.634 3.634 2.739 4.739 2.739H5.826M10.174 2.739H11.261C12.366 2.739 13.261 3.634 13.261 4.739V5.826M13.261 10.174V11.261C13.261 12.366 12.366 13.261 11.261 13.261H10.174M5.826 13.261H4.739C3.634 13.261 2.739 12.366 2.739 11.261V10.174" />
    </Icon>
  );
}

/** Which side a per-side field edits. */
export type SideName = 'top' | 'right' | 'bottom' | 'left';

const SIDE_PATHS: Record<SideName, string> = {
  top: 'M3 3H13',
  right: 'M13 3V13',
  bottom: 'M3 13H13',
  left: 'M3 3V13',
};

/** A square with one side drawn solid (the others faint). */
export function SideIcon({ side, ...props }: IconProps & { side: SideName }): ReactNode {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="10" height="10" rx="1" strokeOpacity={0.3} strokeDasharray="1.5 1.5" />
      <path d={SIDE_PATHS[side]} strokeWidth={1.5} />
    </Icon>
  );
}

/** Which corner a per-corner field edits. */
export type CornerName = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

const CORNER_ROTATION: Record<CornerName, number> = { 'top-left': 0, 'top-right': 90, 'bottom-right': 180, 'bottom-left': 270 };

/** One rounded corner. */
export function CornerIcon({ corner, ...props }: IconProps & { corner: CornerName }): ReactNode {
  return (
    <Icon {...props}>
      <path d="M3.5 12.5V8C3.5 5.515 5.515 3.5 8 3.5H12.5" transform={`rotate(${CORNER_ROTATION[corner]} 8 8)`} />
    </Icon>
  );
}

/** A solid stroke. */
export function StrokeSolidIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props} strokeWidth={1.5}>
      <path d="M2 8H14" />
    </Icon>
  );
}

/** A dashed stroke. */
export function StrokeDashedIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props} strokeWidth={1.5}>
      <path d="M1.5 8H4.5M6.5 8H9.5M11.5 8H14.5" />
    </Icon>
  );
}

/** A dotted stroke. */
export function StrokeDottedIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props} strokeWidth={1.5}>
      <path d="M2 8H2.01M5 8H5.01M8 8H8.01M11 8H11.01M14 8H14.01" />
    </Icon>
  );
}

/** Three lines of rising weight (stroke thickness). */
export function WeightIcon(props: IconProps): ReactNode {
  return (
    <Icon {...props}>
      <path d="M3.2 3H12.8" />
      <path d="M3.2 8H12.8" strokeWidth={1.5} />
      <path d="M3.2 13H12.8" strokeWidth={2} />
    </Icon>
  );
}
