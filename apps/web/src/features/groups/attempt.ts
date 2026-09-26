import { ApiError } from '../../lib/api'
import { toast } from '../../ui'

/** Runs a settings action, surfacing the server's message on failure. */
export async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn()
    return true
  } catch (e) {
    toast({ type: 'error', message: e instanceof ApiError ? e.message : '操作失败，请重试' })
    return false
  }
}
