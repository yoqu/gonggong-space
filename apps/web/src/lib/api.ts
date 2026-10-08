import type { ErrorCode } from '@gonggong/protocol'
import { locale, t } from '../i18n'
import { storedTeam } from './team'

export type ApiErrorCode = ReturnType<(typeof ErrorCode)['parse']> | 'http_error' | 'network_error'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

const teamHeader = (): Record<string, string> => {
  const team = storedTeam()
  return team ? { 'x-gg-team': team } : {}
}

async function request<T>(method: string, path: string, body?: unknown, plain = false): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: { 'accept-language': locale, ...teamHeader() },
  }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError(0, 'network_error', t('网络连接失败，请检查网络后重试'))
  }
  if (res.ok) return (res.status === 204 ? undefined : plain ? await res.text() : await res.json()) as T

  if (res.status === 401) onUnauthorized?.()
  const text = await res.text()
  let parsed: { error?: ApiErrorCode; message?: string } = {}
  try {
    parsed = JSON.parse(text) ?? {}
  } catch {}
  const fallback =
    res.status >= 500
      ? t('服务暂时不可用（HTTP {status}）', { status: res.status })
      : t('请求失败（HTTP {status}）', { status: res.status })
  throw new ApiError(res.status, parsed.error ?? 'http_error', parsed.message || fallback)
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  /** A plain-text body. */
  text: (path: string) => request<string>('GET', path, undefined, true),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
}

/** User-facing text for a failure; a bare HTTP error (proxy, gateway) reads as the server being unreachable. */
export const errorText = (err: unknown) =>
  err instanceof ApiError
    ? err.code === 'http_error'
      ? t('无法连接服务器，请稍后重试')
      : err.message
    : err instanceof Error
      ? err.message
      : t('操作失败，请重试')
