import { type GroupDto, GroupParams } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { attempt, toastError } from '../../lib/errors'
import {
  AvatarEditor,
  Button,
  Dialog,
  GroupBox,
  GroupRow,
  Icon,
  type IconName,
  SegmentedControl,
  Spinner,
  Stepper,
  Switch,
  TextField,
  toast,
} from '../../ui'
import { InheritedMcpList, McpLayerList, McpSaved, useMcpLayer } from '../config/ConfigPage'
import { GroupConfigView } from '../config/GroupConfigView'
import { InheritedSkillList, SkillLayerList } from '../config/SkillLayer'
import { GroupFeishuTab } from '../feishu/GroupFeishuTab'
import { InstalledSection } from '../market/InstallList'
import { GroupPluginsTab } from '../plugins/PluginLayer'
import { RepoSettings } from '../repos/RepoSettings'
import { GroupSecrets } from '../secrets/GroupSecrets'
import { groupsApi } from './api'
import { GroupAvatar } from './GroupAvatar'
import { BotsView, MembersView, type SettingsTab } from './GroupInfo'

/** Only the P1 params are adjustable (spec §10). */
const PARAMS: { key: keyof GroupParams; label: string }[] = [
  { key: 'approvalTimeoutMin', label: t('权限审批等待（分钟）') },
  { key: 'chainMaxHops', label: t('接力链长上限（跳）') },
  { key: 'offlineWaitMin', label: t('Bot 离线等待上线（分钟）') },
]

type Draft = Record<keyof GroupParams, number | null>

const parseDraft = (d: Draft) => GroupParams.safeParse(d)

/** Group settings dialog (prototype ovSettings); plain members get it read-only, filling only their own secret values. */
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
  // Reopened on another tab while still closing, the dialog is reused rather than remounted.
  useEffect(() => setTab(initial), [initial])
  const [params, setParams] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const dm = group.kind === 'dm'
  const meId = useSession((s) => s.user?.id)
  const readOnly = !group.members.some((m) => m.userId === meId && m.isAdmin)
  const pluginsOn = useSession((s) => !!s.tenancy?.pluginsEnabled)
  const tabs: { value: SettingsTab; label: string; icon: IconName }[] = [
    { value: 'basic', label: t('基本信息'), icon: 'info' },
    ...(dm ? [] : [{ value: 'members' as const, label: t('成员'), icon: 'person-2' as const }]),
    { value: 'bots', label: 'Bot', icon: 'bot' },
    { value: 'repo', label: t('仓库与同步'), icon: 'git-branch' },
    { value: 'params', label: dm ? t('参数#settings') : t('群级参数'), icon: 'slider-horizontal' },
    ...(dm
      ? []
      : [
          { value: 'mcp' as const, label: 'MCP', icon: 'plug' as const },
          { value: 'skill' as const, label: 'Skill', icon: 'star' as const },
          { value: 'secrets' as const, label: t('密钥'), icon: 'lock' as const },
          // Its view carries the chat binding and app ids, so the server serves it to admins only.
          ...(readOnly ? [] : [{ value: 'feishu' as const, label: t('飞书'), icon: 'message' as const }]),
        ]),
    ...(pluginsOn ? [{ value: 'plugins' as const, label: t('插件'), icon: 'apps' as const }] : []),
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
          <span className="gs-desc">
            {readOnly ? t('仅群管理员可修改') : tab === 'params' ? t('保存后对新会话生效') : ''}
          </span>
          <span className="spacer" />
          {tab === 'params' && !readOnly ? (
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
            <BasicTab group={group} readOnly={readOnly} />
          ) : tab === 'members' ? (
            <MembersTab group={group} readOnly={readOnly} />
          ) : tab === 'bots' ? (
            <BotsView group={group} isAdmin={!readOnly} member />
          ) : tab === 'repo' ? (
            <RepoSettings group={group} isAdmin={!readOnly} />
          ) : readOnly && (tab === 'mcp' || tab === 'skill') ? (
            <>
              <GroupConfigView groupId={group.id} kind={tab} />
              {tab === 'skill' ? <InstalledSection base={`/groups/${group.id}`} readOnly /> : null}
            </>
          ) : tab === 'mcp' ? (
            <GroupMcpTab group={group} />
          ) : tab === 'skill' ? (
            <>
              <div className="gs-note">{t('只对本群生效；与团队层、平台层同名时以群层为准。')}</div>
              <SkillLayerList base={`/groups/${group.id}/skills`} tag={t('群层')} />
              <InheritedSkillList groupId={group.id} />
              <InstalledSection base={`/groups/${group.id}`} onLeave={onClose} />
            </>
          ) : tab === 'secrets' ? (
            <GroupSecrets group={group} editable={!readOnly} />
          ) : tab === 'plugins' ? (
            <GroupPluginsTab group={group} readOnly={readOnly} />
          ) : tab === 'feishu' ? (
            <GroupFeishuTab group={group} />
          ) : params ? (
            <GroupBox>
              {PARAMS.map((p) => (
                <GroupRow key={p.key} label={p.label}>
                  <Stepper
                    aria-label={p.label}
                    disabled={readOnly}
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

function BasicTab({ group, readOnly }: { group: GroupDto; readOnly: boolean }) {
  const me = useSession((s) => s.user)
  const dm = group.kind === 'dm'
  const [name, setName] = useState(group.name)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    if (await attempt(() => groupsApi.update(group.id, { name: name.trim() })))
      toast({ type: 'success', message: t('名称已保存') })
    setSaving(false)
  }
  return (
    <GroupBox>
      <GroupRow label={dm ? t('私聊名称') : t('群名称')}>
        <span className="gs-value-line">
          <TextField
            aria-label={dm ? t('私聊名称') : t('群名称')}
            value={name}
            maxLength={60}
            readOnly={readOnly}
            onChange={(e) => setName(e.target.value)}
          />
          {readOnly ? null : (
            <Button
              size="small"
              disabled={!name.trim() || name.trim() === group.name || saving}
              onClick={() => void save()}
            >
              {t('保存')}
            </Button>
          )}
        </span>
      </GroupRow>
      {dm ? null : (
        <GroupRow label={t('群头像')} description={t('未上传时由成员头像拼成')}>
          {readOnly ? (
            <GroupAvatar group={group} size={40} />
          ) : (
            <AvatarEditor
              name={group.name}
              shape="square"
              src={group.avatar ?? undefined}
              preview={<GroupAvatar group={group} size={40} />}
              onUpload={(image) => groupsApi.uploadAvatar(group.id, image)}
              onRemove={() => groupsApi.removeAvatar(group.id)}
            />
          )}
        </GroupRow>
      )}
      <GroupRow label={t('回复风格')} description={t('先写结论、口语化，不贴表名、代码和 SQL，依据放在末尾')}>
        {readOnly ? (
          <span className="gs-value">{group.replyStyle === 'business' ? t('业务') : t('技术')}</span>
        ) : (
          <SegmentedControl
            aria-label={t('回复风格')}
            size="small"
            items={[
              { value: 'tech', label: t('技术') },
              { value: 'business', label: t('业务') },
            ]}
            value={group.replyStyle ?? 'tech'}
            onChange={(replyStyle) => void attempt(() => groupsApi.update(group.id, { replyStyle }))}
          />
        )}
      </GroupRow>
      {dm ? (
        <GroupRow label={t('类型')}>
          <span className="gs-value">{t('私聊 · 仅你和你的 Bot，不能邀请他人')}</span>
        </GroupRow>
      ) : (
        <GroupRow label={t('群管理员')}>
          <span className="gs-value">
            {group.members
              .filter((m) => m.isAdmin)
              .map((m) => (m.userId === me?.id ? t('{name}（我）', { name: m.name }) : m.name))
              .join(t('、'))}
          </span>
        </GroupRow>
      )}
    </GroupBox>
  )
}

/** 成员: who may invite and the people; the Bots live with the workspaces. */
function MembersTab({ group, readOnly }: { group: GroupDto; readOnly: boolean }) {
  return (
    <>
      <GroupBox>
        <GroupRow
          label={t('仅群管理员可拉人')}
          description={t('关闭时所有成员都能拉人；成员始终可拉入自己的 Bot')}
        >
          <Switch
            aria-label={t('仅群管理员可拉人')}
            disabled={readOnly}
            checked={group.adminOnlyInvite}
            onChange={(v) => void attempt(() => groupsApi.update(group.id, { adminOnlyInvite: v }))}
          />
        </GroupRow>
        <GroupRow label={t('公开频道')} description={t('团队成员可在「浏览频道」中找到并自行加入')}>
          <Switch
            aria-label={t('公开频道')}
            disabled={readOnly}
            checked={group.visibility === 'public'}
            onChange={(v) =>
              void attempt(() => groupsApi.update(group.id, { visibility: v ? 'public' : 'private' }))
            }
          />
        </GroupRow>
      </GroupBox>
      <MembersView
        group={group}
        isAdmin={!readOnly}
        canInvite={!readOnly || !group.adminOnlyInvite}
        initialAdding={false}
      />
    </>
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
      <InheritedMcpList groupId={group.id} />
    </>
  )
}
