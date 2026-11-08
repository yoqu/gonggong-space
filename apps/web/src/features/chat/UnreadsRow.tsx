import { useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { AlertDialog, Presence, ShortcutContent, toast } from '../../ui'
import { escFree } from './unreadMark'

/** 全部未读 in the sidebar: bold while any group has unread messages, never a count (plan 未读与通知). */
export function UnreadsRow() {
  const groups = useWorkspace((s) => s.groups.filter((g) => g.unread > 0 && g.notifyLevel !== 'off').length)
  const detail = groups ? t('{n} 个群有未读消息', { n: groups }) : t('没有未读消息')
  return (
    <>
      <NavLink to="/unreads" className="pn-shortcut" data-testid="unreads-item" title={detail} tabIndex={-1}>
        <ShortcutContent icon="tray" label={t('全部未读')} detail={detail} bold={groups > 0} />
      </NavLink>
      <ReadAllShortcut />
    </>
  )
}

/** Shift+Esc: every group of the team read, after a confirmation. */
function ReadAllShortcut() {
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !e.shiftKey || e.defaultPrevented || !escFree()) return
      e.preventDefault()
      setAsking(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const confirm = async () => {
    setAsking(false)
    try {
      await api.post('/groups/read-all', {})
    } catch {
      toast({ type: 'error', message: t('操作失败，请重试') })
    }
  }
  return (
    <Presence>
      {asking ? (
        <AlertDialog
          open
          title={t('全部标为已读？')}
          message={t('当前团队所有群的未读消息都会标为已读。')}
          onClose={() => setAsking(false)}
          actions={[
            { label: t('取消'), onClick: () => setAsking(false) },
            { label: t('全部标为已读'), variant: 'primary', onClick: () => void confirm() },
          ]}
        />
      ) : null}
    </Presence>
  )
}
