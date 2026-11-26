import type { GroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useInspector } from '../../app/inspector'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { Button, Dialog, PinnedBanner, toast } from '../../ui'
import { groupsApi } from './api'

export const isGroupAdmin = (group: GroupDto, userId?: string) =>
  group.members.some((m) => m.userId === userId && m.isAdmin)

export const hideNotice = (groupId: string, hidden: boolean) =>
  attempt(() => groupsApi.prefs(groupId, { noticeHidden: hidden }))

/** Admins remove the notice for everyone; it stays in the history. */
export function RemoveNoticeDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const close = () => {
    if (!busy) onClose()
  }
  const run = async () => {
    if (busy) return
    setBusy(true)
    if (await attempt(() => groupsApi.removeNotice(groupId))) {
      toast({ type: 'success', message: t('已移除群公告') })
      onClose()
    } else setBusy(false)
  }
  return (
    <Dialog
      open
      title={t('要移除群公告吗？')}
      width={400}
      closeOnBackdrop={false}
      onClose={close}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            {t('取消')}
          </Button>
          <Button variant="destructive" loading={busy} onClick={() => void run()}>
            {t('移除')}
          </Button>
        </>
      }
    >
      <p className="gs-note">{t('移除后所有成员都不再看到这条公告，仍可在群设置「群公告」中查看历史。')}</p>
    </Dialog>
  )
}

/** The pinned notice atop the chat: × only hides it for me; admins remove it for everyone from 群公告. */
export function GroupNotice({ group, readOnly = false }: { group: GroupDto; readOnly?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (!group.notice || group.noticeHidden) return null
  const hide = async () => {
    if (await hideNotice(group.id, true))
      toast({
        type: 'success',
        message: t('已隐藏，可在群设置「群公告」中查看'),
        action: { label: t('撤销#undo'), onClick: () => void hideNotice(group.id, false) },
      })
  }
  return (
    <div data-testid="group-notice">
      <PinnedBanner
        text={group.notice}
        textTitle={group.notice}
        expanded={readOnly ? expanded : undefined}
        onClick={
          readOnly
            ? () => setExpanded((v) => !v)
            : () => useInspector.getState().open('group-info', 'notices')
        }
        closeLabel={t('不再显示此公告')}
        onClose={readOnly ? undefined : () => void hide()}
      />
      {readOnly && expanded ? (
        <div className="pn-pinned__expanded" data-testid="group-notice-expanded">
          {group.notice}
        </div>
      ) : null}
    </div>
  )
}
