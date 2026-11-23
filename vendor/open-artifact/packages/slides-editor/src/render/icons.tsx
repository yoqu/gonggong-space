/**
 * Glyphs of the format's built-in icon names, drawn with the open-source
 * Lucide set. The names are the format's; the drawing is the renderer's.
 */

import type { ComponentType, SVGProps } from 'react';
import {
  Activity,
  BadgeCheck,
  BookOpen,
  ChartColumn,
  Check,
  CircleCheck,
  Clock,
  Cloud,
  Code,
  Database,
  Globe,
  GraduationCap,
  Hammer,
  Handshake,
  House,
  Key,
  Lightbulb,
  Link,
  Lock,
  MessageCircle,
  Play,
  Search,
  Send,
  Settings,
  Star,
  ThumbsUp,
  TriangleAlert,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import type { IconName } from '@open-artifact/slides-core';

/** Props the glyph components take. */
export type GlyphProps = SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string; absoluteStrokeWidth?: boolean };

/** Format icon name → Lucide component. */
export const ICON_GLYPHS: Record<IconName, ComponentType<GlyphProps>> = {
  Activity,
  Book: BookOpen,
  Chart: ChartColumn,
  Chat: MessageCircle,
  Check,
  CheckCircle: CircleCheck,
  Clock,
  Cloud,
  Code,
  Database,
  Globe,
  GraduationCap,
  Home: House,
  Key,
  Lightbulb,
  Lightning: Zap,
  Link,
  Lock,
  PaperPlane: Send,
  Play,
  Search,
  Settings,
  Star,
  ThumbsUp,
  Tool: Hammer,
  Trust: Handshake,
  Users,
  Verified: BadgeCheck,
  Warning: TriangleAlert,
  Wrench,
};
