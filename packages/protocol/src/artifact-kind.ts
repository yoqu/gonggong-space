import { z } from 'zod'

/**
 * What an artifact is, fixed when it is created (docs/plan/产物容器-开发计划.md §4.1): its plugin manifest's
 * `artifact.kind`, `site` for hosted sites, `prototype` for everything made before kinds existed.
 */
export const ArtifactKind = z.enum(['prototype', 'site', 'slides', 'whiteboard', 'motion'])
export type ArtifactKind = z.infer<typeof ArtifactKind>
/** Formats an editor exports in the browser (plan D3). */
export const ArtifactExportFormat = z.enum(['pdf', 'png', 'pptx', 'html', 'mp4', 'gif', 'mov', 'zip'])
export type ArtifactExportFormat = z.infer<typeof ArtifactExportFormat>
/** `db`: live per-document state (artifact_docs) serialized into versions; `files`: versions only. */
export const ArtifactStore = z.enum(['files', 'db'])
export type ArtifactStore = z.infer<typeof ArtifactStore>
/** The AIs offered under the canvas's input, whatever the artifact's group: they run there without joining it. */
export const ARTIFACT_BOT_NAMES = ['共字君', '姜维川的 Claude Code']
