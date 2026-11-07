import type { GroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { Button, ConfirmActionDialog, GroupBox, GroupRow, Icon, Presence, Switch, Tag } from '../../ui'
import { groupsApi } from '../groups/api'
import { SyncModeTab } from '../sync/SyncModeTab'
import { type Extra, RepoDialog, type RepoTarget } from './RepoDialog'
import { repoPath } from './RepoPicker'
import { repoIcon } from './repo-access'

/**
 * 群设置 ·「仓库与同步」: the repos every bot works in (the main one carries the base branch and force sync), the push
 * rule and the sync mode. Admins edit; where each bot keeps its clones lives with the bot.
 */
export function RepoSettings({ group, isAdmin }: { group: GroupDto; isAdmin: boolean }) {
  const [editing, setEditing] = useState<RepoTarget | null>(null)
  const [removing, setRemoving] = useState<Extra | null>(null)
  const [unbinding, setUnbinding] = useState(false)
  const extras = group.extraRepos ?? []
  const canUnbind = group.mode === 'partition' && !extras.length

  return (
    <div className="rw">
      <section className="rw-section">
        <h3 className="rw-section__title">{t('代码仓库')}</h3>
        <GroupBox>
          {group.repo ? (
            <GroupRow
              label={
                <span className="rw-repo" title={group.repo.url}>
                  <Icon name={repoIcon(group.repo.url)} size={14} />
                  {repoPath(group.repo.url)}
                  <Tag tone="blue">{t('主#repo')}</Tag>
                </span>
              }
              description={t('基准分支 {branch}', { branch: group.repo.branch })}
            >
              {isAdmin ? (
                <span className="gs-value-line">
                  <Button size="small" onClick={() => setEditing('main')}>
                    {t('更换…')}
                  </Button>
                  <Button
                    size="small"
                    disabled={!canUnbind}
                    title={canUnbind ? undefined : t('先移除其他仓库并切回分区模式')}
                    onClick={() => setUnbinding(true)}
                  >
                    {t('解绑…')}
                  </Button>
                </span>
              ) : null}
            </GroupRow>
          ) : (
            <GroupRow label={<span className="gs-value">{t('未绑定 · 各 Bot 使用本机目录')}</span>}>
              {isAdmin ? (
                <Button size="small" onClick={() => setEditing('main')}>
                  {t('绑定仓库…')}
                </Button>
              ) : null}
            </GroupRow>
          )}
          {extras.map((r) => (
            <GroupRow
              key={r.id}
              label={
                <span className="rw-repo" title={r.url}>
                  <Icon name={repoIcon(r.url)} size={14} />
                  {repoPath(r.url)}
                </span>
              }
              description={t('分支 {branch}', { branch: r.branch })}
            >
              {isAdmin ? (
                <span className="gs-value-line">
                  <Button
                    size="small"
                    aria-label={t('更改仓库 {repo}', { repo: repoPath(r.url) })}
                    onClick={() => setEditing(r)}
                  >
                    {t('更改…')}
                  </Button>
                  <Button
                    size="small"
                    aria-label={t('移除仓库 {repo}', { repo: repoPath(r.url) })}
                    onClick={() => setRemoving(r)}
                  >
                    {t('移除…')}
                  </Button>
                </span>
              ) : null}
            </GroupRow>
          ))}
          {isAdmin && group.repo ? (
            <GroupRow label="">
              <Button size="small" variant="plain" icon="plus" onClick={() => setEditing('new')}>
                {t('添加仓库…')}
              </Button>
            </GroupRow>
          ) : null}
        </GroupBox>
        <div className="rw-note">
          {group.repo
            ? t(
                '各 Bot 默认自动克隆每个仓库，Bot 主人可在「Bot」里改用本机目录（remote 须一致）；其他仓库按各自分支提交和推送，不参与强制同步。',
              )
            : t('绑定仓库后，各 Bot 自动克隆并在功能分支上工作；可再添加其他仓库。')}
        </div>
      </section>

      {group.repo ? (
        <section className="rw-section">
          <h3 className="rw-section__title">{t('推送规则')}</h3>
          <GroupBox>
            <GroupRow
              label={t('禁止直推基准分支')}
              description={t('Bot 在功能分支上提交，推送到基准分支需要 Bot 主人审批')}
            >
              <Switch
                aria-label={t('禁止直推基准分支')}
                disabled={!isAdmin}
                checked={group.protectBase}
                onChange={(v) => void attempt(() => groupsApi.update(group.id, { protectBase: v }))}
              />
            </GroupRow>
          </GroupBox>
        </section>
      ) : null}

      <section className="rw-section">
        <h3 className="rw-section__title">{t('同步模式')}</h3>
        <SyncModeTab group={group} />
      </section>

      <Presence>
        {editing ? <RepoDialog group={group} target={editing} onClose={() => setEditing(null)} /> : null}
      </Presence>
      <Presence>
        {removing ? (
          <ConfirmActionDialog
            title={t('移除仓库')}
            message={t('确定移除仓库 {repo}？', { repo: repoPath(removing.url) })}
            consequences={[
              t('各 Bot 从下一轮起不再使用它，并开始新会话'),
              t('已有克隆保留在各自机器上，不会删除'),
            ]}
            label={t('移除')}
            done={t('已移除仓库')}
            run={() => groupsApi.removeExtraRepo(group.id, removing.id)}
            onClose={() => setRemoving(null)}
          />
        ) : null}
      </Presence>
      <Presence>
        {unbinding && group.repo ? (
          <ConfirmActionDialog
            title={t('解绑仓库')}
            message={t('确定解绑仓库 {repo}？', { repo: repoPath(group.repo.url) })}
            consequences={[
              t('自动克隆的 Bot 改用默认工作区；没有默认工作区的需主人重新选择'),
              t('已使用本机目录的 Bot 不变'),
              t('自动克隆保留在各自机器上，不会删除'),
            ]}
            label={t('解绑仓库')}
            done={t('已解绑仓库')}
            run={() => groupsApi.setRepo(group.id, { url: '', branch: '' })}
            onClose={() => setUnbinding(false)}
          />
        ) : null}
      </Presence>
    </div>
  )
}
