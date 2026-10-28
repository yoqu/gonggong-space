import type { GroupTabDto, GroupTabsDto, GroupTabTargetReq, LinkMetaDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { useInspector } from '../../app/inspector'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { openTab } from '../workbench/open'

/** Each group's tab bar (群标签栏), loaded on first use and replaced by `group.tabs` events. */
const useStore = create<Record<string, GroupTabDto[]>>()(() => ({}))
const loading = new Set<string>()

let synced = false
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if (e.t === 'group.tabs') useStore.setState({ [e.groupId]: e.tabs })
  })
  // Events missed while offline: the next use reloads.
  realtime.onReconnect(() => useStore.setState({}, true))
}

function load(groupId: string) {
  if (loading.has(groupId)) return
  loading.add(groupId)
  api
    .get<GroupTabsDto>(`/groups/${groupId}/tabs`)
    .then((d) => useStore.setState({ [groupId]: d.tabs }))
    .catch(() => {})
    .finally(() => loading.delete(groupId))
}

export function useGroupTabs(groupId: string): GroupTabDto[] | undefined {
  const tabs = useStore((s) => s[groupId])
  useEffect(() => {
    sync()
    if (!tabs) load(groupId)
  }, [groupId, tabs])
  return tabs
}

const put = (groupId: string) => (d: GroupTabsDto) => useStore.setState({ [groupId]: d.tabs })
const base = (groupId: string) => `/groups/${groupId}/tabs`

export const groupTabsApi = {
  create: (groupId: string, body: { title?: string; target: GroupTabTargetReq }) =>
    api.post<GroupTabsDto>(base(groupId), body).then(put(groupId)),
  rename: (groupId: string, id: string, title: string) =>
    api.patch<GroupTabsDto>(`${base(groupId)}/${id}`, { title }).then(put(groupId)),
  remove: (groupId: string, id: string) => api.del<GroupTabsDto>(`${base(groupId)}/${id}`).then(put(groupId)),
  reorder: (groupId: string, ids: string[]) => {
    const tabs = useStore.getState()[groupId] ?? []
    // Shown at once; the answer (or the reload after a 409) settles it.
    useStore.setState({ [groupId]: ids.map((id) => tabs.find((x) => x.id === id)).filter((x) => !!x) })
    return api
      .put<GroupTabsDto>(`${base(groupId)}/order`, { ids })
      .then(put(groupId))
      .catch((e) => {
        load(groupId)
        throw e
      })
  },
  linkMeta: (url: string) => api.post<LinkMetaDto>('/link-meta', { url }),
}

/** Where a tab leads outside the app (新标签页打开 / 复制链接); null for in-app pages. */
export function tabHref(groupId: string, tab: GroupTabDto): string | null {
  const x = tab.target
  if (x.kind === 'link') return x.url
  if (x.kind === 'file')
    return `/api/groups/${groupId}/bots/${x.botId}/files/raw?path=${encodeURIComponent(x.path)}`
  return null
}

/** Opens a tab in its in-app place: the workbench, the group-info inspector or the pinned messages. */
export function openGroupTab(tab: GroupTabDto) {
  const x = tab.target
  switch (x.kind) {
    case 'link':
      if (x.embeddable) openTab({ kind: 'link', url: x.url, title: tab.title })
      else window.open(x.url, '_blank', 'noopener,noreferrer')
      return
    case 'knowledge':
      openTab({ kind: 'knowledge', knowledgeId: x.knowledgeId, title: tab.title })
      return
    case 'file':
      openTab({ kind: 'file', source: { botId: x.botId, path: x.path } })
      return
    case 'entry':
      if (x.entry === 'git-log' && x.botId) openTab({ kind: 'git', botId: x.botId, view: 'log' })
      else if (x.entry === 'pins') usePinsExpanded.setState({ at: Date.now() })
      else useInspector.getState().open('group-info', x.entry === 'notice' ? 'notices' : 'schedules')
  }
}

/** Asks the pinned-messages banner to expand and come into view (标签「置顶消息」). */
export const usePinsExpanded = create<{ at: number }>()(() => ({ at: 0 }))
