import { z } from 'zod'

// ── Link nodes: web pages (Feishu docs…) members put on an artifact's canvas, kept in gg-artifact.json ─────────
/** `free`: the card keeps its own `h`; a fixed ratio derives the height from `w`. */
export const ArtifactLinkRatio = z.enum(['16:9', '4:3', '3:4', '1:1', 'free'])
export type ArtifactLinkRatio = z.infer<typeof ArtifactLinkRatio>
/** `embed`: the page loads in an iframe on the card; `card`: a one-line card that opens it (sites that forbid framing). */
export const ArtifactLinkDisplay = z.enum(['embed', 'card'])
export type ArtifactLinkDisplay = z.infer<typeof ArtifactLinkDisplay>
export const ARTIFACT_LINKS_MAX = 50
export const ARTIFACT_LINK_MIN_W = 240
export const ARTIFACT_LINK_MAX_W = 2400
export const LinkUrl = z
  .string()
  .max(2000)
  .regex(/^https?:\/\/[^\s"'<>\\`]+$/i)
export const LinkSize = z.number().finite().min(ARTIFACT_LINK_MIN_W).max(ARTIFACT_LINK_MAX_W)
export const LinkFields = {
  url: LinkUrl,
  title: z.string().trim().min(1).max(120),
  display: ArtifactLinkDisplay,
  ratio: ArtifactLinkRatio,
}
/** A web page members put on the canvas (a Feishu doc, say): context for people and the agent, not part of the prototype. */
export const GgArtifactLink = z.object({
  id: z
    .string()
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  ...LinkFields,
  w: LinkSize.optional(),
  /** Only with ratio `free`. */
  h: LinkSize.optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
})
export type GgArtifactLink = z.infer<typeof GgArtifactLink>
/** POST /api/artifacts/:id/link-meta: what a new link node shows; unreadable pages give a null title and try framing. */
export const ArtifactLinkMetaReq = z.object({ url: LinkUrl })
export type ArtifactLinkMetaReq = z.infer<typeof ArtifactLinkMetaReq>
export const ArtifactLinkMetaRes = z.object({
  title: z.string().max(120).nullable(),
  embeddable: z.boolean(),
})
export type ArtifactLinkMetaRes = z.infer<typeof ArtifactLinkMetaRes>
