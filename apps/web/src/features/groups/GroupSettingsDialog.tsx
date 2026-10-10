import { type GroupDto, GroupParams } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { Button, Dialog, GroupBox, GroupRow, Icon, type IconName, Spinner, Stepper, toast } from '../../ui'
import { McpLayerList, McpSaved, useMcpLayer } from '../config/ConfigPage'
import { SkillLayerList } from '../config/SkillLayer'
import { GroupFeishuTab } from '../feishu/GroupFeishuTab'
import { RepoWorkspaceView } from '../repos/RepoWorkspaceView'
import { SyncModeTab } from '../sync/SyncModeTab'
import { groupsApi } from './api'
import { BotsView, type SettingsTab } from './GroupInfo'

/** Only the P1 params are adjustable (spec §10). */
const PARAMS: { key: keyof GroupParams; label: string }[] = [
  { key: 'approvalTimeoutMin', label: t('权限审批等待（分钟）') },
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
    ...(dm
      ? []
      : [
          { value: 'mcp' as const, label: 'MCP', icon: 'plug' as const },
          { value: 'skill' as const, label: 'Skill', icon: 'star' as const },
          { value: 'feishu' as const, label: t('飞书'), icon: 'message' as const },
        ]),
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
            <BotsView group={group} isAdmin member />
          ) : tab === 'repo' ? (
            <RepoWorkspaceView group={group} isAdmin />
          ) : tab === 'mcp' ? (
            <GroupMcpTab group={group} />
          ) : tab === 'skill' ? (
            <>
              <div className="gs-note">{t('只对本群生效；与团队层、平台层同名时以群层为准。')}</div>
              <SkillLayerList base={`/groups/${group.id}/skills`} tag={t('群层')} />
            </>
          ) : tab === 'feishu' ? (
            <GroupFeishuTab group={group} />
          ) : tab === 'mode' ? (
            <SyncModeTab group={group} />
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
    { k: dm ? t('私聊名称') : t('群名'), v: group.name },
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

/** 群设置 · MCP: the group layer, overriding same-named team and platform servers (plan D8). */
function GroupMcpTab({ group }: { group: GroupDto }) {
  const layer = useMcpLayer(`/groups/${group.id}/mcp`)
  return (
    <>
      <div className="gs-note">{t('只对本群生效；与团队层、平台层同名时以群层为准。')}</div>
      <McpLayerList layer={layer} tag={t('群层')} />
      <McpSaved force={layer.savedForce} />
    </>
  )
}
