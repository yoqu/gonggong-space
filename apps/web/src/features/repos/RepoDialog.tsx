import { type BotProbeDto, type GroupDto, repoKey } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { Button, Dialog, GroupBox, toast } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { groupsApi } from '../groups/api'
import { RepoPicker, repoPath } from './RepoPicker'
import { AccessResult, emptyRepo, type RepoDraft, repoBody, repoValidated } from './repo-access'

export type Extra = NonNullable<GroupDto['extraRepos']>[number]
/** The main repo, an extra one, or a new extra one. */
export type RepoTarget = 'main' | Extra | 'new'

/** Binds or changes the main repo, or adds or changes an extra one, after checking it from each bot's machine. */
export function RepoDialog({
  group,
  target,
  onClose,
}: {
  group: GroupDto
  target: RepoTarget
  onClose: () => void
}) {
  const allBots = useWorkspace((s) => s.bots)
  const main = target === 'main'
  const old = main || target === 'new' ? null : target
  const [draft, setDraft] = useState<RepoDraft>(() =>
    old
      ? { url: old.url, branch: old.branch, check: null }
      : emptyRepo(main ? group.repo?.branch : undefined),
  )
  const [saving, setSaving] = useState(false)
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))
  const results = new Map<string, BotProbeDto>(
    draft.check && draft.check !== 'checking' ? draft.check.results.map((r) => [r.botId, r]) : [],
  )

  const save = async () => {
    const body = repoBody(draft)
    setSaving(true)
    try {
      if (main) await groupsApi.setRepo(group.id, body)
      else if (old && repoKey(old.url) === repoKey(body.url))
        await groupsApi.updateExtraRepo(group.id, old.id, body)
      else {
        // Another repo in its place: added first, so a refused one leaves the old in place.
        await groupsApi.addExtraRepo(group.id, body)
        if (old) await groupsApi.removeExtraRepo(group.id, old.id)
      }
      toast({
        type: 'success',
        message: !main
          ? t('已保存仓库 · 各 Bot 将克隆并从下一轮起使用')
          : group.repo
            ? t('已更换主仓库 · 各 Bot 的自动克隆将重建')
            : t('已绑定仓库'),
      })
      onClose()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      width={600}
      title={
        main
          ? group.repo
            ? t('更换主仓库')
            : t('绑定仓库')
          : old
            ? t('更改仓库 {repo}', { repo: repoPath(old.url) })
            : t('添加仓库')
      }
      onClose={onClose}
      footer={
        <>
          <span className="gs-desc">{main && group.repo ? t('各 Bot 的自动克隆将重建') : ''}</span>
          <span className="spacer" />
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button
            variant="primary"
            disabled={!draft.url || !repoValidated(draft) || saving}
            onClick={() => void save()}
          >
            {draft.check === 'checking'
              ? t('检查中…')
              : main
                ? group.repo
                  ? t('更换仓库')
                  : t('绑定仓库')
                : t('保存')}
          </Button>
        </>
      }
    >
      <div className="rw">
        <GroupBox>
          <RepoPicker draft={draft} set={(o) => setDraft((d) => ({ ...d, ...o }))} botIds={group.botIds} />
        </GroupBox>
        {bots.length ? (
          <section className="rw-section">
            <h3 className="rw-section__title">{t('各 Bot 的访问检查')}</h3>
            <GroupBox>
              {bots.map((b) => {
                const r = results.get(b.id)
                return (
                  <div key={b.id} className="rw-bot" data-testid={`repo-check-${b.id}`}>
                    <BotAvatar id={b.id} name={b.name} size={24} />
                    <span className="rw-bot__main">
                      <span className="rw-bot__name">{b.name}</span>
                    </span>
                    {r ? <AccessResult result={r} /> : null}
                  </div>
                )
              })}
            </GroupBox>
          </section>
        ) : null}
      </div>
    </Dialog>
  )
}
