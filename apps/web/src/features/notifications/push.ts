import type { PushSubscriptionReq } from '@aiws/protocol'
import { api } from '../../lib/api'

export type PushState = 'unsupported' | NotificationPermission

export const pushState = (): PushState =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    ? Notification.permission
    : 'unsupported'

const base64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function registration() {
  await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

/** Registers this browser's push subscription with the server (idempotent: keyed by endpoint). */
async function subscribe() {
  const reg = await registration()
  const { publicKey } = await api.get<{ publicKey: string }>('/push/key')
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64url(publicKey) }))
  await api.post('/push/subscriptions', sub.toJSON() as PushSubscriptionReq)
}

/** 「开启浏览器通知」: asks for permission, then subscribes. Returns the resulting permission. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission()
  if (permission === 'granted') await subscribe()
  return permission
}

/** Re-registers after login when permission was granted earlier, so pushes reach the current account. */
export async function syncPush() {
  if (pushState() === 'granted') await subscribe()
}

/** On logout: this browser must stop receiving the previous account's pushes. */
export async function disablePush() {
  if (pushState() === 'unsupported') return
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  if (!sub) return
  await api.del(`/push/subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`)
  await sub.unsubscribe()
}
