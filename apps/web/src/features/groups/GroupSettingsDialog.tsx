import { type GroupDto, GroupParams } from '@aiws/protocol'
import { Bot, Info, RefreshCw, SlidersHorizontal, Users } from 'lucide-react'
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { ApiError } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Alert, Button, Dialog, Input, Spinner, toast } from '../../ui'
import { type RepoDraft, RepoFields, repoBody, repoValidated } from '../chat/RepoFields'
import { groupsApi } from './api'
import { BotsView, type SettingsTab } from './GroupDrawer'

/** Only the P1 params are adjustable (spec §10); /hold, forced-sync approval wait and dispatch timeout are P2. */
const PARAMS: { key: keyof GroupParams; label: string }[] = [
  { key: 'approvalTimeoutMin', label: '权限审批等待 · 分区（分钟）' },
  { key: 'chainMaxHops', label: '接力链长上限（跳）' },
  { key: 'offlineWaitMin', label: 'bot 离线等待上线（分钟）' },
]

type Draft = Record<keyof GroupParams, string>

const parseDraft = (d: Draft) =>
  GroupParams.safeParse(Object.fromEntries(PARAMS.map((p) => [p.key, Number(d[p.key])])))

/** Group settings dialog (prototype ovSettings); admins only. */
export function GroupSettingsDialog({
  group,
  tab: initial,
  onClose,
}: {
  group: GroupDto
  tab: SettingsTab
  onClose: () => void
}) {
  const [tab, setTab] = useState(initial)
  const [repo, setRepo] = useState<RepoDraft | null>(null)
  const [params, setParams] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const dm = group.kind === 'dm'
  const tabs: { value: SettingsTab; label: string; icon: typeof Info }[] = [
    { value: 'basic', label: '基本信息', icon: Info },
    { value: 'bots', label: dm ? 'Bot' : '成员与 bot', icon: dm ? Bot : Users },
    { value: 'mode', label: '同步模式', icon: RefreshCw },
    { value: 'params', label: dm ? '参数' : '群级参数', icon: SlidersHorizontal },
  ]

  useEffect(() => {
    groupsApi.params(group.id).then(
      (p) => setParams(Object.fromEntries(PARAMS.map(({ key }) => [key, String(p[key])])) as Draft),
      () => {},
    )
  }, [group.id])

  const parsed = params && parseDraft(params)
  const canSave = tab === 'basic' ? !!repo && repoValidated(repo) : !!parsed?.success
  const save = async () => {
    setSaving(true)
    try {
      if (tab === 'basic' && repo) {
        await groupsApi.setRepo(group.id, repoBody(repo))
        toast({
          type: 'success',
          message: group.repo ? '已更换仓库 · 各 bot 的托管工作区将重建' : '已绑定仓库',
        })
      } else if (parsed?.success) {
        await groupsApi.saveParams(group.id, parsed.data)
        toast({ type: 'success', message: '群级参数已保存' })
      }
      onClose()
    } catch (e) {
      toast({ type: 'error', message: e instanceof ApiError ? e.message : '保存失败，请重试' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      width={820}
      title={`${tabs.find((t) => t.value === tab)?.label} · ${group.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="gs-desc">{tab === 'mode' ? '' : '保存后对新会话生效'}</span>
          <span className="spacer" />
          {tab === 'basic' || tab === 'params' ? (
            <Button variant="primary" disabled={!canSave || saving} onClick={() => void save()}>
              保存
            </Button>
          ) : null}
        </>
      }
    >
      <div className="gs-settings">
        <nav className="gs-settings__nav">
          <span className="eyebrow">群设置</span>
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              className={cx('gs-settings__tab', t.value === tab && 'gs-settings__tab--on')}
              aria-current={t.value === tab ? 'page' : undefined}
              onClick={() => setTab(t.value)}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="gs-settings__body">
          {tab === 'basic' ? (
            <BasicTab group={group} draft={repo} setDraft={setRepo} />
          ) : tab === 'bots' ? (
            <BotsView group={group} isAdmin />
          ) : tab === 'mode' ? (
            <div className="gs-mode">
              <div className="repo-settings__row">
                <span className="repo-settings__key">当前模式</span>
                <span>{GROUP_MODE_LABEL[group.mode]}</span>
              </div>
              <div className="gs-desc">
                切换到强制同步后，同一时刻只有一个写入者，每轮结束后所有在线机器的工作树保持一致（不同步
                .git）。
              </div>
              <div>
                <Button variant="outline" size="sm" disabled>
                  切换到强制同步
                </Button>
              </div>
              <div className="gs-desc">强制同步为二期</div>
            </div>
          ) : params ? (
            <div className="gs-params">
              {PARAMS.map((p) => (
                <label key={p.key} className="gs-param" htmlFor={`gp-${p.key}`}>
                  <span>{p.label}</span>
                  <Input
                    id={`gp-${p.key}`}
                    size="sm"
                    inputMode="numeric"
                    value={params[p.key]}
                    invalid={!GroupParams.shape[p.key].safeParse(Number(params[p.key])).success}
                    onChange={(e) => setParams({ ...params, [p.key]: e.target.value.trim() })}
                  />
                </label>
              ))}
            </div>
          ) : (
            <Spinner />
          )}
        </div>
      </div>
    </Dialog>
  )
}

function BasicTab({
  group,
  draft,
  setDraft,
}: {
  group: GroupDto
  draft: RepoDraft | null
  setDraft: Dispatch<SetStateAction<RepoDraft | null>>
}) {
  const me = useSession((s) => s.user)
  const dm = group.kind === 'dm'
  const rows = [
    { k: dm ? '私聊名' : '群名', v: group.name, mono: false },
    { k: '远端仓库', v: group.repo?.url ?? '未绑定', mono: !!group.repo },
    { k: '基准分支', v: group.repo?.branch ?? '—', mono: !!group.repo },
    dm
      ? { k: '类型', v: '私聊 · 仅你和你的 bot，不能邀请他人', mono: false }
      : {
          k: '群管理员',
          v: group.members
            .filter((m) => m.isAdmin)
            .map((m) => (m.userId === me?.id ? `${m.name}（我）` : m.name))
            .join('、'),
          mono: false,
        },
  ]
  return (
    <div className="repo-settings">
      {rows.map((r) => (
        <div key={r.k} className="repo-settings__row">
          <span className="repo-settings__key">{r.k}</span>
          <span className={r.mono ? 'repo-settings__mono' : undefined}>{r.v}</span>
          {r.k === '远端仓库' && !draft ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft({ url: '', branch: group.repo?.branch ?? 'main', check: null })}
            >
              {group.repo ? '更换' : '绑定仓库'}
            </Button>
          ) : null}
        </div>
      ))}
      {draft ? <RepoFields draft={draft} set={(o) => setDraft((d) => d && { ...d, ...o })} /> : null}
      <Alert
        variant="info"
        title="一期一群一仓库"
        description="数据模型已按「群 → 多仓库」设计，二期开放多仓库绑定。更换仓库会重建所有 bot 的托管工作区。"
      />
    </div>
  )
}
