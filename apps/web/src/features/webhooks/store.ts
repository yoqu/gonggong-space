import type {
  CreateWebhookReq,
  GroupWebhooksDto,
  UpdateWebhookReq,
  WebhookDto,
  WebhookTokenDto,
} from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'

/** Each group's inbound webhooks, loaded on first use and replaced by `group.webhooks` events. */
const useStore = create<Record<string, WebhookDto[]>>()(() => ({}))
const loading = new Set<string>()

let synced = false
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if (e.t === 'group.webhooks') useStore.setState({ [e.groupId]: e.webhooks })
  })
  realtime.onReconnect(() => useStore.setState({}, true))
}

function load(groupId: string) {
  if (loading.has(groupId)) return
  loading.add(groupId)
  api
    .get<GroupWebhooksDto>(`/groups/${groupId}/webhooks`)
    .then((r) => useStore.setState({ [groupId]: r.webhooks }))
    .catch(() => {})
    .finally(() => loading.delete(groupId))
}

export function useWebhooks(groupId: string): WebhookDto[] | undefined {
  const list = useStore((s) => s[groupId])
  useEffect(() => {
    sync()
    if (!list) load(groupId)
  }, [groupId, list])
  return list
}

const put = (w: WebhookDto) => {
  useStore.setState((all) => ({
    [w.groupId]: (all[w.groupId] ?? []).some((x) => x.id === w.id)
      ? (all[w.groupId] ?? []).map((x) => (x.id === w.id ? w : x))
      : [...(all[w.groupId] ?? []), w],
  }))
  return w
}

export const webhooksApi = {
  create: (groupId: string, body: CreateWebhookReq) =>
    api.post<WebhookTokenDto>(`/groups/${groupId}/webhooks`, body).then((res) => {
      put(res.webhook)
      return res
    }),
  update: (id: string, body: UpdateWebhookReq) => api.patch<WebhookDto>(`/webhooks/${id}`, body).then(put),
  rotate: (id: string) =>
    api.post<WebhookTokenDto>(`/webhooks/${id}/rotate`).then((res) => {
      put(res.webhook)
      return res
    }),
  remove: (w: WebhookDto) =>
    api
      .del(`/webhooks/${w.id}`)
      .then(() =>
        useStore.setState((all) => ({ [w.groupId]: (all[w.groupId] ?? []).filter((x) => x.id !== w.id) })),
      ),
}

/** Tests: forget loaded lists and the realtime hook-up. */
export function resetWebhooks() {
  useStore.setState({}, true)
  loading.clear()
  synced = false
}
