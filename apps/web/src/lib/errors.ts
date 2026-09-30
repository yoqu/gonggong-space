import { toast } from '../ui/toast'
import { errorText } from './api'

export const toastError = (err: unknown, title?: string) =>
  toast({ type: 'error', title, message: errorText(err) })

/** Runs an action, toasting the failure; resolves whether it succeeded. */
export async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn()
    return true
  } catch (e) {
    toastError(e)
    return false
  }
}
