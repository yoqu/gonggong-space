import type { ErrorCode } from '@aiws/protocol'

export type ApiErrorCode = ReturnType<(typeof ErrorCode)['parse']> | 'http_error'

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
  const res = await fetch(`/api${path}`, init)
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T

  if (res.status === 401) onUnauthorized?.()
  const text = await res.text()
  let parsed: { error?: ApiErrorCode; message?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {}
  throw new ApiError(res.status, parsed.error ?? 'http_error', parsed.message ?? (text || res.statusText))
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
}
