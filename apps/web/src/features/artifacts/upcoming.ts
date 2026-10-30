import type {
  ArtifactCard,
  ArtifactDto,
  ArtifactEditOp,
  ArtifactVersionDto,
  GgArtifactManifest,
  Rect,
} from '@gonggong/protocol'

// Round 4 wire fields the server is adding (stitch-对比-第3轮 G04 / G08, 第2轮 R04): local until they land in
// @gonggong/protocol, then these give way to the protocol's own types.

export type RefKind = 'image' | 'pdf' | 'text'
/** A file uploaded to the canvas (gg-artifact.json `refs`): a reference node, and context the AI can be pointed at. */
export interface ArtifactRef {
  id: string
  title: string
  /** `refs/<name>` in the version. */
  file: string
  kind: RefKind
  /** Where the member put it on the canvas; absent: laid out below the screens. */
  x?: number
  y?: number
}
export type RefOp =
  | { kind: 'ref'; uploadId: string; title: string }
  | { kind: 'ref-delete'; id: string }
  | { kind: 'ref-move'; id: string; x: number; y: number }
  | { kind: 'ref-rename'; id: string; title: string }
export type EditOp = ArtifactEditOp | RefOp

export const refsOf = (m: GgArtifactManifest | null | undefined): ArtifactRef[] =>
  (m as (GgArtifactManifest & { refs?: ArtifactRef[] }) | null | undefined)?.refs ?? []

/** What the uploads route takes for a reference, by extension (a browser often types .md as nothing). */
export const REF_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
}
export const REF_ACCEPT = Object.keys(REF_TYPES)
  .map((e) => `.${e}`)
  .join(',')

/** `mark-rect`: the member dragged a box in a screen with the mark tool; `rect` in its viewport, `ggIds` inside it. */
export interface BridgeMarkRect {
  source: 'gg-bridge'
  file: string
  type: 'mark-rect'
  rect: Rect
  ggIds: string[]
}

/** R04: runs on the artifact waiting for its bot's machine. */
export const queuedOf = (a: ArtifactDto) => {
  const q = a as ArtifactDto & { queued?: boolean; queuedRunCount?: number }
  return q.queued ? Math.max(1, q.queuedRunCount ?? 1) : 0
}

/** The thumbnail shows an earlier version (the new one is still being rendered). */
export const thumbnailStale = (v: ArtifactVersionDto | ArtifactCard | null | undefined) =>
  !!(v as { thumbnailStale?: boolean } | null | undefined)?.thumbnailStale

/** Per-screen thumbnails of a version, when the server has rendered them (Copy as PNG). */
export const screenThumbsOf = (v: ArtifactVersionDto | null | undefined) =>
  (v as { screenThumbs?: { screenId: string; url: string }[] } | null | undefined)?.screenThumbs ?? []
