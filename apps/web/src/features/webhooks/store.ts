import type {
  CreateWebhookReq,
  GroupWebhooksDto,
  UpdateWebhookReq,
  WebhookDto,
  WebhookTokenDto,
} from '@gonggong/protocol'
import { api } from '../../lib/api'
import { createGroupStore, upsertById } from '../../lib/groupStore'

/** Each group's inbound webhooks, loaded on first use and replaced by `group.webhooks` events. */
const store = createGroupStore<WebhookDto[]>({
  load: (groupId) => api.get<GroupWebhooksDto>(`/groups/${groupId}/webhooks`).then((r) => r.webhooks),
  onEvent: (e) => (e.t === 'group.webhooks' ? { groupId: e.groupId, value: e.webhooks } : null),
})

export const useWebhooks = store.use
export const resetWebhooks = store.reset

const put = (w: WebhookDto) => {
  store.update(w.groupId, (list) => upsertById(list, w))
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
      .then(() => store.update(w.groupId, (list) => (list ?? []).filter((x) => x.id !== w.id))),
}
