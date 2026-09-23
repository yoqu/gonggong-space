import type { ErrorCode } from '@aiws/protocol'
import type { z } from 'zod'

const STATUS: Record<z.infer<typeof ErrorCode>, number> = {
  unauthorized: 401,
  forbidden: 403,
  must_change_password: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  code_expired: 410,
  code_locked: 423,
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

export const fail = (code: z.infer<typeof ErrorCode>, message: string): never => {
  throw new HttpError(code, message)
}
