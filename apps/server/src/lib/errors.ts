import type { ErrorCode, I18nParams } from '@gonggong/protocol'
import type { z } from 'zod'
import { type MessageKey, t } from '../i18n/index.js'

const STATUS: Record<z.infer<typeof ErrorCode>, number> = {
  unauthorized: 401,
  forbidden: 403,
  must_change_password: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  code_expired: 410,
  code_locked: 423,
  recall_expired: 409,
  edit_expired: 409,
}

export class HttpError extends Error {
  constructor(
    readonly code: z.infer<typeof ErrorCode>,
    message: string,
  ) {
    super(message)
  }
  get status() {
    return STATUS[this.code]
  }
}

/** `message` is a Chinese source text, translated for the requester. */
export const fail = (code: z.infer<typeof ErrorCode>, message: MessageKey, params?: I18nParams): never => {
  throw new HttpError(code, t(message, params))
}
