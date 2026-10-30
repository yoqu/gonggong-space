import { type GroupDto, repoKey } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, ConfirmActionDialog, GroupBox, GroupRow, Icon, Presence, toast } from '../../ui'
import { groupsApi } from '../groups/api'
import { RepoPicker, repoPath } from './RepoPicker'
import { emptyRepo, type RepoDraft, repoBody, repoIcon, repoValidated } from './repo-access'

type Extra = NonNullable<GroupDto['extraRepos']>[number]

/**
 * 附加仓库: repos cloned beside the main one and given to every bot's session as additional directories (partition
 * groups with a main repo). Admins add, re-branch and remove them; a change starts new sessions.
 */
export function ExtraRepos({ group, isAdmin }: { group: GroupDto; isAdmin: boolean }) {
  const extras = group.extraRepos ?? []
  /** The repo being edited, or 'new'. */
  const [editing, setEditing] = useState<{ repo: Extra | 'new'; draft: RepoDraft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Extra | null>(null)
  if (!group.repo || group.mode !== 'partition' || (!isAdmin && !extras.length)) return null

  const save = async () => {
    if (!editing) return
    const body = repoBody(editing.draft)
    const old = editing.repo === 'new' ? null : editing.repo
    setSaving(true)
    try {
      if (old && repoKey(old.url) === repoKey(body.url))
        await groupsApi.setExtraRepoBranch(group.id, old.id, body.branch)
      else {
        // Another repo in its place: added first, so a refused one leaves the old in place.
        await groupsApi.addExtraRepo(group.id, body)
        if (old) await groupsApi.removeExtraRepo(group.id, old.id)
      }
      toast({ type: 'success', message: t('已保存附加仓库 · 各 Bot 将克隆并从下一轮起使用') })
      setEditing(null)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rw-section">
      <h3 className="rw-section__title">{t('附加仓库')}</h3>
      <GroupBox>
        {editing ? (
          <RepoPicker
            draft={editing.draft}
            set={(o) => setEditing((e) => e && { ...e, draft: { ...e.draft, ...o } })}
            botIds={group.botIds}
          />
        ) : (
          <>
            {extras.map((r) => (
              <GroupRow
                key={r.id}
                label={
                  <span className="rw-repo" title={r.url}>
                    <Icon name={repoIcon(r.url)} size={14} />
                    {repoPath(r.url)}
                  </span>
                }
              >
                <span className="gs-value-line">
                  <span className="gs-value">{r.branch}</span>
                  {isAdmin ? (
                    <>
                      <Button
                        size="small"
                        aria-label={t('更改附加仓库 {repo}', { repo: repoPath(r.url) })}
                        onClick={() =>
                          setEditing({ repo: r, draft: { url: r.url, branch: r.branch, check: null } })
                        }
                      >
                        {t('更改…')}
                      </Button>
                      <Button
                        size="small"
                        aria-label={t('移除附加仓库 {repo}', { repo: repoPath(r.url) })}
                        onClick={() => setRemoving(r)}
                      >
                        {t('移除…')}
                      </Button>
                    </>
                  ) : null}
                </span>
              </GroupRow>
            ))}
            {isAdmin ? (
              <GroupRow label={<span className="gs-value">{extras.length ? null : t('未添加')}</span>}>
                <Button size="small" onClick={() => setEditing({ repo: 'new', draft: emptyRepo() })}>
                  {t('添加附加仓库…')}
                </Button>
              </GroupRow>
            ) : null}
          </>
        )}
      </GroupBox>
      {editing ? (
        <div className="rw-actions">
          <span className="spacer" />
          <Button size="small" onClick={() => setEditing(null)}>
            {t('取消')}
          </Button>
          <Button
            size="small"
            variant="primary"
            disabled={!editing.draft.url || !repoValidated(editing.draft) || saving}
            onClick={() => void save()}
          >
            {editing.draft.check === 'checking' ? t('检查中…') : t('保存')}
          </Button>
        </div>
      ) : (
        <div className="rw-note">
          {t('附加仓库克隆在主仓库旁边，作为附加目录提供给各 Bot，每个仓库按自己的默认分支提交和推送。')}
        </div>
      )}
      <Presence>
        {removing ? (
          <ConfirmActionDialog
            title={t('移除附加仓库')}
            message={t('确定移除附加仓库 {repo}？', { repo: repoPath(removing.url) })}
            consequences={[
              t('各 Bot 从下一轮起不再使用它，并开始新会话'),
              t('已有克隆保留在各自机器上，不会删除'),
            ]}
            label={t('移除')}
            done={t('已移除附加仓库')}
            run={() => groupsApi.removeExtraRepo(group.id, removing.id)}
            onClose={() => setRemoving(null)}
          />
        ) : null}
      </Presence>
    </section>
  )
}
