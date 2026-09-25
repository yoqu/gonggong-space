import type { ErrorCode } from '@gonggong/protocol'

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError(0, 'network_error', '网络连接失败，请检查网络后重试')
  }
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T

  if (res.status === 401) onUnauthorized?.()
  const text = await res.text()
  let parsed: { error?: ApiErrorCode; message?: string } = {}
  try {
    parsed = JSON.parse(text) ?? {}
  } catch {}
  const fallback =
    res.status >= 500 ? `服务暂时不可用（HTTP ${res.status}）` : `请求失败（HTTP ${res.status}）`
  throw new ApiError(res.status, parsed.error ?? 'http_error', parsed.message || fallback)
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
}
