import type { BotDto, BotProbeDto, GroupBotStateDto, GroupDto, RepoAccessReason } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, GroupBox, GroupRow, Icon, Presence, toast } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { groupsApi } from '../groups/api'
import { WorkspacePicker } from '../workspaces/WorkspacePicker'
import { RepoPicker, repoPath } from './RepoPicker'
import { AccessResult, emptyRepo, type RepoDraft, repoBody, repoIcon, repoValidated } from './repo-access'

const PAUSING: Partial<Record<RepoAccessReason, string>> = {
  denied: t('无权限'),
  network: t('网络或证书'),
  timeout: t('超时'),
}

/** Keeps both ends of a long path: `/Users/w/…/pay/refund`. */
const middle = (path: string, max = 40) =>
  path.length <= max ? path : `${path.slice(0, max / 2 - 1)}…${path.slice(-(max / 2 - 1))}`

function workspaceText(s: GroupBotStateDto | undefined, online: boolean) {
  if (!s || s.state === 'unbound') return t('未选择工作区')
  const paused = s.state === 'failed' && s.reason ? PAUSING[s.reason] : undefined
  if (paused) return t('已暂停 · {reason}', { reason: paused })
  if (s.workspace === 'cd' && s.path) return <span className="rw-path">{middle(s.path)}</span>
  if (s.state === 'ready') return t('托管克隆 · 就绪')
  if (s.state === 'cloning') return t('克隆中…')
  if (s.state === 'pending') return online ? t('克隆中…') : t('等待上线')
  return s.error ?? t('失败')
}

/**
 * 「仓库与工作区」: the group repo (admins can change it) and where each bot works; a bot's owner can move it to
 * another workspace at any time. Used by the settings dialog and the chat inspector.
 */
export function RepoWorkspaceView({ group, isAdmin }: { group: GroupDto; isAdmin: boolean }) {
  const me = useSession((s) => s.user)
  const allBots = useWorkspace((s) => s.bots)
  const states = useWorkspace((s) => s.botStates[group.id])
  const [draft, setDraft] = useState<RepoDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState<BotDto | null>(null)
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))
  const results = new Map<string, BotProbeDto>(
    draft?.check && draft.check !== 'checking' ? draft.check.results.map((r) => [r.botId, r]) : [],
  )

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      await groupsApi.setRepo(group.id, repoBody(draft))
      toast({
        type: 'success',
        message: group.repo ? t('已更换仓库 · 各 Bot 的托管工作区将重建') : t('已绑定仓库'),
      })
      setDraft(null)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }
  const recheck = (bot: BotDto) =>
    api
      .post(`/groups/${group.id}/bots/${bot.id}/recheck`)
      .then(() => toast({ type: 'info', message: t('正在让 {name} 的机器重新 clone…', { name: bot.name }) }))
      .catch(toastError)

  return (
    <div className="rw">
      <section className="rw-section">
        <h3 className="rw-section__title">{t('仓库')}</h3>
        <GroupBox>
          {draft ? (
            <RepoPicker
              draft={draft}
              set={(o) => setDraft((d) => d && { ...d, ...o })}
              botIds={group.botIds}
            />
          ) : (
            <>
              <GroupRow label={t('仓库')}>
                <span className="gs-value-line">
                  {group.repo ? (
                    <span className="rw-repo" title={group.repo.url}>
                      <Icon name={repoIcon(group.repo.url)} size={14} />
                      {repoPath(group.repo.url)}
                    </span>
                  ) : (
                    <span className="gs-value">{t('未绑定 · 各 Bot 使用本机目录')}</span>
                  )}
                  {isAdmin ? (
                    <Button size="small" onClick={() => setDraft(emptyRepo(group.repo?.branch))}>
                      {group.repo ? t('更换…') : t('绑定仓库…')}
                    </Button>
                  ) : null}
                </span>
              </GroupRow>
              {group.repo ? <GroupRow label={t('基准分支')} value={group.repo.branch} /> : null}
            </>
          )}
        </GroupBox>
        {draft ? (
          <div className="rw-actions">
            {group.repo ? <span className="rw-note">{t('各 Bot 的托管工作区将重建')}</span> : null}
            <span className="spacer" />
            <Button size="small" onClick={() => setDraft(null)}>
              {t('取消')}
            </Button>
            <Button
              size="small"
              variant="primary"
              disabled={!draft.url || !repoValidated(draft) || saving}
              onClick={() => void save()}
            >
              {draft.check === 'checking' ? t('检查中…') : group.repo ? t('更换仓库') : t('绑定仓库')}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="rw-section">
        <h3 className="rw-section__title">{t('各 Bot 的工作区')}</h3>
        <GroupBox>
          {bots.map((b) => {
            const s = states?.[b.id]
            const mine = b.ownerId === me?.id
            const online = b.presence !== 'offline' && b.binding === 'bound'
            const paused = s?.state === 'failed' && !!s.reason && !!PAUSING[s.reason]
            const r = results.get(b.id)
            return (
              <div key={b.id} className="rw-bot" data-testid={`rw-bot-${b.id}`}>
                <BotAvatar id={b.id} name={b.name} size={24} />
                <span className="rw-bot__main">
                  <span className="rw-bot__name">{mine ? b.name : `${b.name} · ${b.ownerName}`}</span>
                  <span className="rw-bot__sub">{workspaceText(s, online)}</span>
                </span>
                {draft ? (
                  r ? (
                    <AccessResult result={r} />
                  ) : null
                ) : (
                  <>
                    {paused && (mine || isAdmin) ? (
                      <Button size="small" onClick={() => void recheck(b)}>
                        {t('重新检查')}
                      </Button>
                    ) : null}
                    {mine ? (
                      <Button
                        size="small"
                        disabled={!online || !b.machineId}
                        title={online ? undefined : t('离线，上线后可更改')}
                        onClick={() => setPicking(b)}
                      >
                        {t('更改…')}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            )
          })}
          {bots.length ? null : <GroupRow label={<span className="gs-value">{t('本群还没有 Bot')}</span>} />}
        </GroupBox>
      </section>
      <Presence>
        {picking?.machineId ? (
          <WorkspacePicker
            group={group}
            bot={{ ...picking, machineId: picking.machineId }}
            onClose={() => setPicking(null)}
          />
        ) : null}
      </Presence>
    </div>
  )
}
