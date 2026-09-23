import type { WebEvent } from '@aiws/protocol'
import type { TestApp } from './app.js'

/** JSON client acting as one logged-in browser. */
export function client(t: TestApp, cookie: string) {
  const call = async <T = { error?: string }>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const res = await t.app.inject({ method, url, headers: { cookie }, payload: payload as object })
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T }
  }
  return {
    get: <T = { error?: string }>(url: string) => call<T>('GET', url),
    post: <T = { error?: string }>(url: string, body: unknown = {}) => call<T>('POST', url, body),
    patch: <T = { error?: string }>(url: string, body: unknown = {}) => call<T>('PATCH', url, body),
    del: <T = { error?: string }>(url: string) => call<T>('DELETE', url),
  }
}

/** Records realtime events published to a user. */
export function events(t: TestApp, userId: string) {
  const got: WebEvent[] = []
  t.ctx.bus.attach(userId, (e) => got.push(e))
  return got
}
