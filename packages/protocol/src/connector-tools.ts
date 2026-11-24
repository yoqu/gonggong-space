import { z } from 'zod'

/** Args of the connector agent tools (connector_status, connector_request). */
export const ConnectorStatusArgs = z.object({
  connector: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .describe('Connector plugin name, e.g. feishu'),
  status: z
    .enum(['ok', 'expired', 'error'])
    .describe(
      'ok: logged in and working; expired: not logged in or the login expired; error: could not tell',
    ),
  account: z.string().max(100).describe('Who the CLI is logged in as (its user name), when known').optional(),
  detail: z.string().max(300).describe('One line on why, for expired / error').optional(),
})
export const ConnectorRequestArgs = z.object({
  connector: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .describe('Connector plugin name, e.g. feishu'),
  reason: z
    .enum(['unconnected', 'expired', 'missing_scope'])
    .describe(
      'unconnected: the CLI is not set up / logged in; expired: the login lapsed; missing_scope: a permission is missing',
    ),
  domains: z
    .array(z.string().regex(/^[a-z_]{1,30}$/))
    .max(30)
    .describe('missing_scope: the CLI domains to authorize (lark-cli --domain values, e.g. calendar, mail)')
    .optional(),
})
