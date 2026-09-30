import type { GroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { attempt } from '../../lib/errors'
import { Button, Dialog, PinnedBanner, Presence, toast } from '../../ui'
import { groupsApi } from './api'

export const isGroupAdmin = (group: GroupDto, userId?: string) =>
  group.members.some((m) => m.userId === userId && m.isAdmin)

export const hideNotice = (groupId: string, hidden: boolean) =>
  attempt(() => groupsApi.prefs(groupId, { noticeHidden: hidden }))

/** Admins remove the notice for everyone; it stays in the history. */
export function RemoveNoticeDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    if (await attempt(() => groupsApi.removeNotice(groupId))) onClose()
    else setBusy(false)
  }
  return (
    <Dialog
      open
      title="移除群公告"
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void run()}>
            移除
          </Button>
        </>
      }
    >
      <p className="gs-note">移除后所有成员都不再看到这条公告，仍可在群设置「群公告」中查看历史。</p>
    </Dialog>
  )
}

/** The pinned notice atop the chat: admins remove it for everyone, members hide it for themselves. */
export function GroupNotice({ group }: { group: GroupDto }) {
  const me = useSession((s) => s.user)
  const [removing, setRemoving] = useState(false)
  if (!group.notice || group.noticeHidden) return null
  const admin = isGroupAdmin(group, me?.id)
  const hide = async () => {
    if (await hideNotice(group.id, true))
      toast({ type: 'success', message: '已隐藏，可在群设置「群公告」中查看' })
  }
  return (
    <div data-testid="group-notice">
      <PinnedBanner
        text={group.notice}
        closeLabel={admin ? '移除' : '不再显示'}
        onClose={admin ? () => setRemoving(true) : () => void hide()}
      />
      <Presence>
        {removing ? <RemoveNoticeDialog groupId={group.id} onClose={() => setRemoving(false)} /> : null}
      </Presence>
    </div>
  )
}
