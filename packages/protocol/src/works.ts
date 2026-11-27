import { z } from 'zod'
import { ArtifactAccess, ArtifactVisibility } from './artifacts.js'

/**
 * How 作品 groups works: the artifact's kind, else its plugin's category (slides made before kinds existed are
 * `prototype` artifacts of a `deck` plugin); poster, dashboard, video… go under `other`.
 */
export const WorkType = z.enum(['prototype', 'slides', 'site', 'whiteboard', 'motion', 'other'])
export type WorkType = z.infer<typeof WorkType>
/** GET /api/works — every artifact the caller may open in the current team (作品), latest first. */
export const WorkDto = z.object({
  id: z.string(),
  groupId: z.string(),
  /** Empty for another member's DM shared with the team (shown as 私聊). */
  groupTitle: z.string(),
  groupKind: z.enum(['group', 'dm', 'works']),
  groupVisibility: z.enum(['public', 'private']),
  title: z.string(),
  /** The plugin's title (产品原型, 幻灯片…). */
  pluginTitle: z.string().nullable(),
  /** A hosted site (托管网页) rather than a design. */
  site: z.boolean(),
  type: WorkType,
  visibility: ArtifactVisibility,
  createdBy: z.string().nullable(),
  creatorName: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  access: ArtifactAccess,
})
export type WorkDto = z.infer<typeof WorkDto>
/** What 作品 新建 can start from the page itself; hosted sites are uploaded with `gg`, other types made in a group. */
export const NewWorkType = z.enum(['prototype', 'slides'])
export type NewWorkType = z.infer<typeof NewWorkType>
/**
 * POST /api/works — 作品 新建 with one of ARTIFACT_BOT_NAMES, no group: answers the empty work to open on its canvas.
 * `templateId` picks among the type's starter templates (GET /api/works/starters); absent: its first.
 */
export const NewWorkReq = z.object({
  botId: z.string(),
  type: NewWorkType.default('prototype'),
  templateId: z.string().max(64).optional(),
})
export type NewWorkReq = z.infer<typeof NewWorkReq>
export const NewWorkRes = z.object({ artifactId: z.string() })
export type NewWorkRes = z.infer<typeof NewWorkRes>
/** GET /api/works/starters — per type 作品 新建 offers, the plugin whose templates it starts from (absent: not on). */
export const WorkStarterDto = z.object({
  type: NewWorkType,
  pluginId: z.string(),
  pluginTitle: z.string(),
  templates: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      group: z.string().nullable(),
      /** Paths inside the plugin, served by previewUrl(pluginId, path). */
      preview: z.string().nullable(),
    }),
  ),
})
export type WorkStarterDto = z.infer<typeof WorkStarterDto>
/**
 * GET /api/works/groups — where the caller can create (作品 shows when there is one): their groups with a creation
 * plugin on, then their private chats with bots (`dm`, creation plugins on there by default), which need no group.
 */
export const WorkGroupDto = z.object({ id: z.string(), title: z.string(), kind: z.enum(['group', 'dm']) })
export type WorkGroupDto = z.infer<typeof WorkGroupDto>
