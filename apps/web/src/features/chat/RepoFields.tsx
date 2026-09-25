import type { ValidateRepoRes } from '@gonggong/protocol'
import { useRef } from 'react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Button, Icon, Input } from '../../ui'

// file:// is accepted for local/test repos; the hint keeps the prototype's wording.
const REPO_URL = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)\S+$/

export interface RepoDraft {
  url: string
  branch: string
  check: 'checking' | ValidateRepoRes | null
}

export const repoValidated = (d: RepoDraft) => d.check !== 'checking' && !!d.check?.ok

export const repoBody = (d: RepoDraft) => ({ url: d.url.trim(), branch: d.branch.trim() || 'main' })

/** Remote URL + base branch inputs with the server-side reachability check (`git ls-remote`). */
export function RepoFields({ draft: d, set }: { draft: RepoDraft; set: (o: Partial<RepoDraft>) => void }) {
  // Answers for an address that has since been edited are dropped.
  const edits = useRef(0)
  const edit = (o: Partial<RepoDraft>) => {
    edits.current += 1
    set({ ...o, check: null })
  }
  const urlOk = REPO_URL.test(d.url.trim())
  const check = d.check === 'checking' ? null : d.check

  const validate = async () => {
    const at = edits.current
    set({ check: 'checking' })
    const res = await api
      .post<ValidateRepoRes>('/groups/validate-repo', repoBody(d))
      .catch(() => ({ ok: false, message: '校验失败，请稍后重试' }))
    if (at === edits.current) set({ check: res })
  }

  return (
    <>
      <div className="ng-repo">
        <Input
          mono
          aria-label="仓库地址"
          value={d.url}
          invalid={!!d.url && !urlOk}
          placeholder="git@git.corp:team/repo.git"
          onChange={(e) => edit({ url: e.target.value })}
        />
        <Input
          mono
          aria-label="基准分支"
          value={d.branch}
          placeholder="main"
          onChange={(e) => edit({ branch: e.target.value })}
        />
        <Button size="sm" disabled={!urlOk || d.check === 'checking'} onClick={() => void validate()}>
          {d.check === 'checking' ? '校验中…' : check?.ok ? '已校验' : '校验'}
        </Button>
      </div>
      {d.url && !urlOk ? (
        <div className="ng-check ng-check--bad">
          <Icon name="xmark-circle" size={13} className="ng-check__icon" />
          地址格式不正确，支持 git@ / https:// / ssh://
        </div>
      ) : check ? (
        <div className={cx('ng-check', check.ok ? 'ng-check--ok' : 'ng-check--bad')}>
          {check.ok ? (
            <Icon name="checkmark-circle" size={13} className="ng-check__icon" />
          ) : (
            <Icon name="xmark-circle" size={13} className="ng-check__icon" />
          )}
          <span>{check.message}</span>
        </div>
      ) : null}
    </>
  )
}
