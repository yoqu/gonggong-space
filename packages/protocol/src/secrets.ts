import { z } from 'zod'

// ── Secrets (plan 团队密钥-方案): a definition per layer, values sealed on the server, injected as env vars ──

/** Env var name; also what `${secret:NAME}` references in MCP env / headers. */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/
export const SecretName = z.string().regex(SECRET_NAME, '名称只能用大写字母、数字和下划线，以字母开头')
/** Shorter values would mask common strings when redacted. */
export const SECRET_MIN_LENGTH = 8
export const SecretValue = z.string().min(SECRET_MIN_LENGTH, '密钥至少 8 个字符').max(8192)

export const SecretScope = z.enum(['platform', 'team', 'group'])
export type SecretScope = z.infer<typeof SecretScope>
/** shared: one value for everyone; shared_overridable: a member's own value wins; personal: each member fills theirs. */
export const SecretMode = z.enum(['shared', 'shared_overridable', 'personal'])
export type SecretMode = z.infer<typeof SecretMode>
/** Where a run's value came from. */
export const SecretSource = z.enum(['personal', 'group', 'team', 'platform'])
export type SecretSource = z.infer<typeof SecretSource>

/**
 * A secret a skill or plugin declares (plan Skill密钥声明): SKILL.md frontmatter `secrets`, a plugin manifest's
 * `secrets`. A gonggong extension, not part of the Agent Skills spec. A bare name means a required shared secret.
 */
export const SecretRequirement = z.object({
  name: SecretName,
  title: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(500).default(''),
  /** Where to get one: https only, shown with its host. */
  url: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), '申请链接只能是 https 地址')
    .optional(),
  /** Hint of the value's shape for the input box. */
  placeholder: z.string().max(60).optional(),
  /** The suggested mode for the definition the installer creates. */
  mode: SecretMode.default('shared'),
  required: z.boolean().default(true),
})
export type SecretRequirement = z.infer<typeof SecretRequirement>
export const SecretRequirements = z
  .array(
    z.union([
      SecretName.transform(
        (name): SecretRequirement => ({ name, description: '', mode: 'shared', required: true }),
      ),
      SecretRequirement,
    ]),
  )
  .max(10)
  .superRefine((specs, ctx) => {
    const seen = new Set<string>()
    for (const [k, s] of specs.entries()) {
      if (seen.has(s.name))
        ctx.addIssue({ code: 'custom', path: [k, 'name'], message: `重复的密钥 ${s.name}` })
      seen.add(s.name)
    }
  })

/** A stored value as anyone may see it: never the value itself. */
export const SecretValueState = z.object({
  last4: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
})
export type SecretValueState = z.infer<typeof SecretValueState>

export const SecretDto = z.object({
  id: z.string(),
  scope: SecretScope,
  teamId: z.string().nullable(),
  groupId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  mode: SecretMode,
  /** null = every bot of the layer; otherwise only these bots get it injected. */
  botIds: z.array(z.string()).nullable(),
  enabled: z.boolean(),
  expiresAt: z.string().nullable(),
  /** The shared value; always null for `personal`. */
  value: SecretValueState.nullable(),
  /** Members who filled their own value (`shared_overridable` / `personal`); names only. */
  personalFilled: z.array(z.object({ userId: z.string(), name: z.string() })),
  /** Group view of inherited rows: overridden by a same-named lower-layer definition. */
  overridden: z.boolean().optional(),
  updatedAt: z.string(),
})
export type SecretDto = z.infer<typeof SecretDto>

/**
 * GET|POST /api/admin/secrets (platform, sysadmin), /api/teams/:teamId/secrets (team owner/admin),
 * /api/groups/:groupId/secrets (group admin; GET also lists inherited platform/team rows to members).
 * PATCH|DELETE /api/secrets/:id — authorized against the row's layer.
 */
export const CreateSecretReq = z.object({
  name: SecretName,
  description: z.string().max(500).default(''),
  mode: SecretMode.default('shared'),
  botIds: z.array(z.string()).nullable().default(null),
  enabled: z.boolean().default(true),
  expiresAt: z.string().nullable().default(null),
  /** Shared value; rejected for `personal`. */
  value: SecretValue.optional(),
})
export type CreateSecretReq = z.infer<typeof CreateSecretReq>
/** Absent fields stay as they are (no defaults here); `value: null` clears the shared value. */
export const UpdateSecretReq = z
  .object({
    name: SecretName,
    description: z.string().max(500),
    mode: SecretMode,
    botIds: z.array(z.string()).nullable(),
    enabled: z.boolean(),
    expiresAt: z.string().nullable(),
  })
  .partial()
  .extend({ value: SecretValue.nullable().optional() })
export type UpdateSecretReq = z.infer<typeof UpdateSecretReq>

/** GET /api/me/secrets: definitions of my teams and groups I may fill a value for (`shared_overridable` / `personal`). */
export const MySecretDto = z.object({
  secret: SecretDto.pick({
    id: true,
    scope: true,
    teamId: true,
    groupId: true,
    name: true,
    description: true,
    mode: true,
    expiresAt: true,
  }),
  /** Team / group name the definition belongs to. */
  where: z.string(),
  /** My value for (team, name); null = not filled. */
  mine: SecretValueState.extend({ allowForeignMachines: z.boolean() }).nullable(),
})
export type MySecretDto = z.infer<typeof MySecretDto>
/** PUT /api/me/secrets/:secretId — keyed by (me, team, name); DELETE clears it. */
export const SetMySecretReq = z.object({
  value: SecretValue.optional(),
  /** false (default): only bots on my own machines get it, since a machine's owner can read its processes' env. */
  allowForeignMachines: z.boolean().default(false),
})
export type SetMySecretReq = z.infer<typeof SetMySecretReq>

/**
 * A 填写密钥 card posted by `secret_request`: `origin` cards are filled by `userId` (personal values),
 * `admins` cards by an admin of the definition's layer (shared values).
 */
export const SecretCard = z.object({
  id: z.string(),
  names: z.array(z.string()),
  /** `define` (plan Skill密钥声明 §7): an admin of `define.layer` makes the definitions a skill declares. */
  audience: z.enum(['origin', 'admins', 'define']),
  userId: z.string().nullable(),
  filled: z.boolean(),
  /** `origin` cards: the asking bot runs on a machine `userId` does not own, so a value needs allowForeignMachines. */
  foreign: z.boolean().optional(),
  /** The definition each name was asked for; cards from before it are asked again rather than guessed. */
  defs: z.record(z.string(), z.string()).optional(),
  define: z
    .object({
      skill: z.string(),
      versionId: z.string(),
      layer: z.object({
        scope: z.enum(['team', 'group']),
        teamId: z.string(),
        groupId: z.string().nullable(),
      }),
      specs: z.array(SecretRequirement),
      /** Who can make them: the layer's admins' names. */
      admins: z.array(z.string()),
    })
    .optional(),
})
export type SecretCard = z.infer<typeof SecretCard>
/** GET /api/secret-requests/:id (the page a Feishu card links to): the card, its group and the asking bot. */
export const SecretRequestDto = SecretCard.extend({ groupId: z.string(), bot: z.string() })
export type SecretRequestDto = z.infer<typeof SecretRequestDto>
/** POST /api/secret-requests/:id; GET /api/groups/:groupId/secret-requests lists my unfilled `origin` cards there. */
export const FillSecretReq = z.object({
  values: z.record(SecretName, SecretValue),
  /** `origin` cards: as SetMySecretReq; absent keeps an existing value's setting (false for a new one). */
  allowForeignMachines: z.boolean().optional(),
})
export type FillSecretReq = z.infer<typeof FillSecretReq>

/**
 * GET /api/groups/:groupId/secret-needs (plan Skill密钥声明 §6): each secret the group's skills (mine included)
 * declare, its state for me and what I can do: `create` the missing definition (an admin of `target`), `fill_shared`
 * its shared value (an admin of its layer), `fill_personal` my own value, `fill_new` my own value of my personal
 * skill's secret, whose per-member team definition is made with it (POST …/secret-needs/personal).
 */
export const SecretNeedDto = z.object({
  skill: z.string(),
  skillVersionId: z.string(),
  /** From my personal install. */
  personalSkill: z.boolean(),
  spec: SecretRequirement,
  status: z.enum(['ok', 'unfilled', 'missing_def', 'blocked']),
  /** `blocked`: 已停用 / 已过期. */
  reason: z.string().optional(),
  def: z
    .object({
      id: z.string(),
      scope: SecretScope,
      mode: SecretMode,
      description: z.string(),
      hasValue: z.boolean(),
    })
    .nullable(),
  /** `missing_def`: where it would be made and with which mode; null for platform skills. */
  target: z
    .object({
      scope: SecretScope,
      teamId: z.string().nullable(),
      groupId: z.string().nullable(),
      mode: SecretMode,
    })
    .nullable()
    .optional(),
  mine: SecretValueState.extend({ allowForeignMachines: z.boolean() }).nullable(),
  action: z.enum(['create', 'fill_shared', 'fill_personal', 'fill_new']).nullable(),
})
export type SecretNeedDto = z.infer<typeof SecretNeedDto>
export const FillNewSecretReq = z.object({
  name: SecretName,
  value: SecretValue,
  allowForeignMachines: z.boolean().default(false),
})
export type FillNewSecretReq = z.infer<typeof FillNewSecretReq>

/** A secret injected into a run (run detail): never the value. */
export const RunSecret = z.object({ name: z.string(), source: SecretSource })
export type RunSecret = z.infer<typeof RunSecret>
