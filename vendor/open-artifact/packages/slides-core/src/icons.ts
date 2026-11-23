/**
 * The built-in icon set of `<x-icon name>`. Names are part of the format; how
 * each one is drawn is up to the renderer (the editor maps them to open-source
 * Lucide glyphs).
 */

export const ICON_NAMES = [
  'Activity', 'Book', 'Chart', 'Chat', 'Check', 'CheckCircle', 'Clock', 'Cloud', 'Code', 'Database',
  'Globe', 'GraduationCap', 'Home', 'Key', 'Lightbulb', 'Lightning', 'Link', 'Lock', 'PaperPlane', 'Play',
  'Search', 'Settings', 'Star', 'ThumbsUp', 'Tool', 'Trust', 'Users', 'Verified', 'Warning', 'Wrench',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** True when the name is one of the built-in icons (exact case). */
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value);
}
