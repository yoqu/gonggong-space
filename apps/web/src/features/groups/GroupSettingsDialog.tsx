import { type GroupDto, GroupParams } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { GROUP_MODE_LABEL } from '../../app/Sidebar'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { Button, Dialog, GroupBox, GroupRow, Icon, type IconName, Spinner, Stepper, toast } from '../../ui'
import { RepoWorkspaceView } from '../repos/RepoWorkspaceView'
import { groupsApi } from './api'
import { BotsView, type SettingsTab } from './GroupInfo'

/** Only the P1 params are adjustable (spec §10); /hold, forced-sync approval wait and dispatch timeout are P2. */
const PARAMS: { key: keyof GroupParams; label: string }[] = [
  { key: 'approvalTimeoutMin', label: t('权限审批等待 · 分区（分钟）') },
  { key: 'chainMaxHops', label: t('接力链长上限（跳）') },
  { key: 'offlineWaitMin', label: t('Bot 离线等待上线（分钟）') },
]

type Draft = Record<keyof GroupParams, number | null>

const parseDraft = (d: Draft) => GroupParams.safeParse(d)

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
  const [params, setParams] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const dm = group.kind === 'dm'
  const tabs: { value: SettingsTab; label: string; icon: IconName }[] = [
    { value: 'basic', label: t('基本信息'), icon: 'info' },
    { value: 'bots', label: dm ? 'Bot' : t('成员与 Bot'), icon: dm ? 'bot' : 'person-2' },
    { value: 'repo', label: t('仓库与工作区'), icon: 'folder-git' },
    { value: 'mode', label: t('同步模式'), icon: 'arrow-clockwise' },
    { value: 'params', label: dm ? t('参数#settings') : t('群级参数'), icon: 'slider-horizontal' },
  ]

  useEffect(() => {
    groupsApi.params(group.id).then(
      (p) => setParams(Object.fromEntries(PARAMS.map(({ key }) => [key, p[key]])) as Draft),
      () => {},
    )
  }, [group.id])

  const parsed = params && parseDraft(params)
  const save = async () => {
    if (!parsed?.success) return
    setSaving(true)
    try {
      await groupsApi.saveParams(group.id, parsed.data)
      toast({ type: 'success', message: t('群级参数已保存') })
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
      width={820}
      title={`${tabs.find((x) => x.value === tab)?.label} · ${group.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="gs-desc">{tab === 'params' ? t('保存后对新会话生效') : ''}</span>
          <span className="spacer" />
          {tab === 'params' ? (
            <Button variant="primary" disabled={!parsed?.success || saving} onClick={() => void save()}>
              {t('保存')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="gs-settings">
        <nav className="gs-settings__nav">
          <span className="gs-settings__heading">{dm ? t('私聊设置') : t('群设置')}</span>
          {tabs.map((x) => (
            <button
              key={x.value}
              type="button"
              className={cx('gs-settings__tab', x.value === tab && 'gs-settings__tab--on')}
              aria-current={x.value === tab ? 'page' : undefined}
              onClick={() => setTab(x.value)}
            >
              <Icon name={x.icon} size={15} />
              {x.label}
            </button>
          ))}
        </nav>
        <div className="gs-settings__body">
          {tab === 'basic' ? (
            <BasicTab group={group} />
          ) : tab === 'bots' ? (
            <BotsView group={group} isAdmin />
          ) : tab === 'repo' ? (
            <RepoWorkspaceView group={group} isAdmin />
          ) : tab === 'mode' ? (
            <div className="gs-mode">
              <GroupBox>
                <GroupRow
                  label={t('当前模式')}
                  description={t(
                    '切换到强制同步后，同一时刻只有一个写入者，每轮结束后所有在线机器的工作树保持一致（不同步 .git）。',
                  )}
                >
                  <span className="gs-value">{GROUP_MODE_LABEL[group.mode]}</span>
                </GroupRow>
                <GroupRow label={t('强制同步')} description={t('强制同步暂未开放')}>
                  <Button disabled>{t('切换到强制同步')}</Button>
                </GroupRow>
              </GroupBox>
            </div>
          ) : params ? (
            <GroupBox>
              {PARAMS.map((p) => (
                <GroupRow key={p.key} label={p.label}>
                  <Stepper
                    aria-label={p.label}
                    width={80}
                    value={params[p.key]}
                    onChange={(v) => setParams({ ...params, [p.key]: v })}
                  />
                </GroupRow>
              ))}
            </GroupBox>
          ) : (
            <Spinner />
          )}
        </div>
      </div>
    </Dialog>
  )
}

function BasicTab({ group }: { group: GroupDto }) {
  const me = useSession((s) => s.user)
  const dm = group.kind === 'dm'
  const rows = [
    { k: dm ? t('私聊名') : t('群名'), v: group.name },
    dm
      ? { k: t('类型'), v: t('私聊 · 仅你和你的 Bot，不能邀请他人') }
      : {
          k: t('群管理员'),
          v: group.members
            .filter((m) => m.isAdmin)
            .map((m) => (m.userId === me?.id ? t('{name}（我）', { name: m.name }) : m.name))
            .join(t('、')),
        },
  ]
  return (
    <GroupBox>
      {rows.map((r) => (
        <GroupRow key={r.k} label={r.k}>
          <span className="gs-value">{r.v}</span>
        </GroupRow>
      ))}
    </GroupBox>
  )
}
