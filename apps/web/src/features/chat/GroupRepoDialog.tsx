import type { GroupDto } from '@aiws/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { Alert, Button, Dialog, toast } from '../../ui'
import { type RepoDraft, RepoFields, repoBody, repoValidated } from './RepoFields'

/** Group settings → 基本信息, reduced to the repo binding (the full settings drawer arrives in M5). */
export function GroupRepoDialog({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const [d, setD] = useState<RepoDraft>({ url: '', branch: group.repo?.branch ?? 'main', check: null })
  const [saving, setSaving] = useState(false)
  const set = (o: Partial<RepoDraft>) => setD((prev) => ({ ...prev, ...o }))

  const save = async () => {
    setSaving(true)
    try {
      const next = await api.patch<GroupDto>(`/groups/${group.id}/repo`, repoBody(d))
      useWorkspace.getState().applyEvent({ t: 'group.updated', group: next })
      toast({
        type: 'success',
        message: group.repo ? '已更换仓库 · 各 bot 的托管工作区将重建' : '已绑定仓库',
      })
      onClose()
    } catch (e) {
      toast({ type: 'error', message: e instanceof ApiError ? e.message : '保存失败，请重试' })
    } finally {
      setSaving(false)
    }
  }

  const rows = [
    { k: group.kind === 'dm' ? '私聊名' : '群名', v: group.name, mono: false },
    { k: '远端仓库', v: group.repo?.url ?? '未绑定', mono: !!group.repo },
    { k: '基准分支', v: group.repo?.branch ?? '—', mono: !!group.repo },
  ]

  return (
    <Dialog
      open
      width={560}
      title={`基本信息 · ${group.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          {editing ? (
            <Button variant="primary" disabled={!repoValidated(d) || saving} onClick={() => void save()}>
              保存
            </Button>
          ) : null}
        </>
      }
    >
      <div className="repo-settings">
        {rows.map((r) => (
          <div key={r.k} className="repo-settings__row">
            <span className="repo-settings__key">{r.k}</span>
            <span className={r.mono ? 'repo-settings__mono' : undefined}>{r.v}</span>
            {r.k === '远端仓库' && !editing ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {group.repo ? '更换' : '绑定仓库'}
              </Button>
            ) : null}
          </div>
        ))}
        {editing ? <RepoFields draft={d} set={set} /> : null}
        <Alert
          variant="info"
          title="一期一群一仓库"
          description="数据模型已按「群 → 多仓库」设计，二期开放多仓库绑定。更换仓库会重建所有 bot 的托管工作区。"
        />
      </div>
    </Dialog>
  )
}
