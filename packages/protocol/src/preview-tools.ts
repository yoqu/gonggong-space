import { z } from 'zod'

// ── Preview tools answered by the daemon (agent-facing, not translated) ─────
export const PreviewStaticArgs = z.object({
  dir: z
    .string()
    .max(500)
    .describe('Workspace dir to publish (e.g. dist, docs/report), default the root')
    .optional(),
  title: z.string().min(1).max(60).describe('Card title: what this is'),
  path: z.string().regex(/^\//).max(500).describe('Path to open, default / (index.html)').optional(),
})

export const PreviewMiniprogramArgs = z.object({
  dir: z
    .string()
    .max(500)
    .describe('Workspace dir of the mini program (with project.config.json), default the root')
    .optional(),
  page: z
    .string()
    .regex(/^[^/?]/)
    .max(300)
    .describe('Page to open, e.g. pages/goods/detail, default the home page')
    .optional(),
  query: z.string().regex(/^[^?]/).max(500).describe('Page query, e.g. id=42&from=share').optional(),
  title: z.string().min(1).max(60).describe('Card title: what this is'),
})

export const PreviewHostArgs = z.object({
  dir: z
    .string()
    .max(500)
    .describe(
      'Workspace dir of the built static site with index.html at its top (e.g. dist), default the root',
    )
    .optional(),
  title: z.string().min(1).max(60).describe('Work title: what this is'),
})

/** preview_host: a static build kept on the server as a work (作品); hosting the same dir again adds a version. */
export const PREVIEW_HOST_TOOL = {
  title: '托管网页到服务器',
  description:
    'Upload a built static site (HTML, JS, CSS, images; no backend) to this space as a work that members open from 作品, even while this machine is offline. ' +
    'Build first (e.g. npm run build), then pass the output dir; calling again with the same dir adds a new version. Use preview_static for a quick look instead.',
  input: PreviewHostArgs,
} as const
