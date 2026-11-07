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
  audience: z.enum(['origin', 'admins']),
  userId: z.string().nullable(),
  filled: z.boolean(),
  /** `origin` cards: the asking bot runs on a machine `userId` does not own, so a value needs allowForeignMachines. */
  foreign: z.boolean().optional(),
})
export type SecretCard = z.infer<typeof SecretCard>
/** POST /api/secret-requests/:id; GET /api/groups/:groupId/secret-requests lists my unfilled `origin` cards there. */
export const FillSecretReq = z.object({
  values: z.record(SecretName, SecretValue),
  /** `origin` cards: as SetMySecretReq; absent keeps an existing value's setting (false for a new one). */
  allowForeignMachines: z.boolean().optional(),
})
export type FillSecretReq = z.infer<typeof FillSecretReq>

/** A secret injected into a run (run detail): never the value. */
export const RunSecret = z.object({ name: z.string(), source: SecretSource })
export type RunSecret = z.infer<typeof RunSecret>
