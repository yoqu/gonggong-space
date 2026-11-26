import { type GroupDto, GroupParams, type JoinRequestDto, type SecretNeedDto } from '@gonggong/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { attempt, toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  AvatarEditor,
  Button,
  Dialog,
  DiscardChangesDialog,
  GroupBox,
  GroupRow,
  Icon,
  type IconName,
  PopUpButton,
  Presence,
  SegmentedControl,
  Spinner,
  Stepper,
  Switch,
  TextField,
  toast,
  useFlash,
  useLeaving,
} from '../../ui'
import { InheritedMcpList, McpLayerList, McpSaved, useMcpLayer } from '../config/ConfigPage'
import { GroupConfigView } from '../config/GroupConfigView'
import { InheritedSkillList, SkillLayerList } from '../config/SkillLayer'
import { GroupFeishuTab } from '../feishu/GroupFeishuTab'
import { InstalledSection } from '../market/InstallList'
import { GroupPluginsTab } from '../plugins/PluginLayer'
import { RepoSettings } from '../repos/RepoSettings'
import { GroupSecrets } from '../secrets/GroupSecrets'
import { NeedsDialog } from '../secrets/SecretNeeds'
import { WebhooksView } from '../webhooks/WebhooksView'
import { groupsApi } from './api'
import { GroupAvatar } from './GroupAvatar'
import { BotsView, MembersView, type SettingsTab } from './GroupInfo'
import { teamSectionsApi, useTeamSections } from './sections'

/** Only the P1 params are adjustable (spec §10). */
const PARAMS: { key: keyof GroupParams; label: string; max: number }[] = [
  { key: 'approvalTimeoutMin', label: t('权限审批等待（分钟）'), max: 24 * 60 },
  { key: 'chainMaxHops', label: t('接力链长上限（跳）'), max: 10 },
  { key: 'offlineWaitMin', label: t('Bot 离线等待上线（分钟）'), max: 24 * 60 },
]

type Draft = Record<keyof GroupParams, number | null>
type PendingAction = { kind: 'close' } | { kind: 'tab'; tab: SettingsTab }

const parseDraft = (d: Draft) => GroupParams.safeParse(d)

/** On phones the tabs scroll in one row; keep the current one in sight. */
const revealTab = (el: HTMLButtonElement | null) =>
  el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })

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
  const [tabDirty, setTabDirty] = useState(false)
  const [tabSaving, setTabSaving] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  // Reopened on another tab while still closing, the dialog is reused rather than remounted.
  useEffect(() => {
    setTab(initial)
    setTabDirty(false)
    setTabSaving(false)
    setPendingAction(null)
  }, [initial])
  const [params, setParams] = useState<Draft | null>(null)
  const [savedParams, setSavedParams] = useState<Draft | null>(null)
  const [paramsError, setParamsError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, flashSaved] = useFlash()
  const paramsReq = useRef(0)
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
          { value: 'webhooks' as const, label: 'Webhook', icon: 'link' as const },
          // Its view carries the chat binding and app ids, so the server serves it to admins only.
          ...(readOnly ? [] : [{ value: 'feishu' as const, label: t('飞书'), icon: 'message' as const }]),
        ]),
    ...(pluginsOn ? [{ value: 'plugins' as const, label: t('插件'), icon: 'apps' as const }] : []),
  ]
  const activeTab: SettingsTab = tabs.some((x) => x.value === tab) ? tab : 'basic'
  useEffect(() => {
    if (activeTab !== tab) setTab(activeTab)
  }, [activeTab, tab])

  const loadParams = useCallback(() => {
    const req = ++paramsReq.current
    setParamsError(null)
    groupsApi.params(group.id).then(
      (p) => {
        if (paramsReq.current !== req) return
        const draft = Object.fromEntries(PARAMS.map(({ key }) => [key, p[key]])) as Draft
        setParams(draft)
        setSavedParams(draft)
        setParamsError(null)
      },
      (e) => {
        if (paramsReq.current !== req) return
        setParamsError(errorText(e))
      },
    )
  }, [group.id])

  useEffect(() => {
    setParams(null)
    setSavedParams(null)
    loadParams()
    return () => {
      paramsReq.current++
    }
  }, [loadParams])

  const parsed = params && parseDraft(params)
  const dirty = !!params && PARAMS.some(({ key }) => params[key] !== savedParams?.[key])
  const hasDirty = !readOnly && (activeTab === 'params' ? dirty : tabDirty)
  const anySaving = saving || tabSaving

  const requestClose = () => {
    if (anySaving) return
    if (hasDirty) setPendingAction({ kind: 'close' })
    else onClose()
  }
  const selectTab = (next: SettingsTab) => {
    if (anySaving || next === activeTab) return
    if (hasDirty) setPendingAction({ kind: 'tab', tab: next })
    else setTab(next)
  }
  const confirmDiscard = () => {
    if (anySaving) return
    const action = pendingAction
    setPendingAction(null)
    setTabDirty(false)
    if (activeTab === 'params' && savedParams) setParams(savedParams)
    if (!action) return
    if (action.kind === 'close') onClose()
    else setTab(action.tab)
  }

  const save = async () => {
    if (!parsed?.success || !dirty || saving) return
    const submitted = parsed.data
    setSaving(true)
    try {
      await groupsApi.saveParams(group.id, submitted)
      setSavedParams(submitted)
      flashSaved()
      toast({ type: 'success', message: t('群级参数已保存，对新会话生效') })
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  const activeLabel = tabs.find((x) => x.value === activeTab)?.label ?? t('基本信息')

  return (
    <>
      <Dialog
        open
        width={820}
        title={`${activeLabel} · ${group.name}`}
        closeOnBackdrop={!hasDirty && !anySaving}
        onClose={requestClose}
        footer={
          readOnly || activeTab === 'params' ? (
            <>
              <span className="gs-desc">
                {readOnly
                  ? t('仅群管理员可修改')
                  : dirty
                    ? t('有未保存的更改 · 保存后对新会话生效')
                    : t('保存后对新会话生效')}
              </span>
              <span className="spacer" />
              {activeTab === 'params' && !readOnly ? (
                <Button
                  variant="primary"
                  disabled={!dirty || !parsed?.success || saving}
                  loading={saving}
                  done={saved && !dirty}
                  onClick={() => void save()}
                >
                  {saving ? t('保存中…') : saved && !dirty ? t('已保存') : t('保存')}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        <div className="gs-settings">
          <nav className="gs-settings__nav">
            <span className="gs-settings__heading">{dm ? t('私聊设置') : t('群设置')}</span>
            {tabs.map((x) => (
              <button
                key={x.value}
                type="button"
                className={cx('gs-settings__tab', x.value === activeTab && 'gs-settings__tab--on')}
                aria-current={x.value === activeTab ? 'page' : undefined}
                ref={x.value === activeTab ? revealTab : undefined}
                onClick={() => selectTab(x.value)}
              >
                <Icon name={x.icon} size={15} />
                {x.label}
              </button>
            ))}
          </nav>
          <div key={activeTab} className="gs-settings__body">
            {activeTab === 'basic' ? (
              <BasicTab
                group={group}
                readOnly={readOnly}
                onDirtyChange={setTabDirty}
                onSavingChange={setTabSaving}
              />
            ) : activeTab === 'members' ? (
              <MembersTab group={group} readOnly={readOnly} />
            ) : activeTab === 'bots' ? (
              <BotsView group={group} isAdmin={!readOnly} member />
            ) : activeTab === 'repo' ? (
              <RepoSettings group={group} isAdmin={!readOnly} />
            ) : readOnly && activeTab === 'mcp' ? (
              <GroupConfigView groupId={group.id} kind="mcp" />
            ) : activeTab === 'mcp' ? (
              <GroupMcpTab group={group} onDirtyChange={setTabDirty} onSavingChange={setTabSaving} />
            ) : activeTab === 'skill' ? (
              <GroupSkillTab group={group} readOnly={readOnly} onClose={onClose} />
            ) : activeTab === 'secrets' ? (
              <GroupSecrets group={group} editable={!readOnly} />
            ) : activeTab === 'webhooks' ? (
              <WebhooksView group={group} readOnly={readOnly} />
            ) : activeTab === 'plugins' ? (
              <GroupPluginsTab group={group} readOnly={readOnly} />
            ) : !readOnly && activeTab === 'feishu' ? (
              <GroupFeishuTab group={group} />
            ) : params ? (
              <GroupBox>
                {PARAMS.map((p) => (
                  <GroupRow key={p.key} label={p.label}>
                    <Stepper
                      live
                      aria-label={p.label}
                      disabled={readOnly}
                      min={1}
                      max={p.max}
                      width={80}
                      value={params[p.key]}
                      onChange={(v) => setParams({ ...params, [p.key]: v })}
                    />
                  </GroupRow>
                ))}
              </GroupBox>
            ) : paramsError ? (
              <Alert
                variant="error"
                title={t('群级参数加载失败')}
                description={paramsError}
                onRetry={loadParams}
              />
            ) : (
              <Spinner />
            )}
          </div>
        </div>
      </Dialog>
      <DiscardChangesDialog
        open={!!pendingAction}
        onCancel={() => setPendingAction(null)}
        onDiscard={confirmDiscard}
      />
    </>
  )
}

function BasicTab({
  group,
  readOnly,
  onDirtyChange,
  onSavingChange,
}: {
  group: GroupDto
  readOnly: boolean
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
}) {
  const me = useSession((s) => s.user)
  const dm = group.kind === 'dm'
  const [name, setName] = useState(group.name)
  const [saving, setSaving] = useState(false)
  const [threadBusy, setThreadBusy] = useState(false)
  const changed = !!name.trim() && name.trim() !== group.name
  const dirty = !readOnly && changed
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useEffect(() => () => onSavingChange?.(false), [onSavingChange])
  const save = async () => {
    if (!changed || saving) return
    setSaving(true)
    onSavingChange?.(true)
    if (await attempt(() => groupsApi.update(group.id, { name: name.trim() })))
      toast({ type: 'success', message: t('名称已保存') })
    setSaving(false)
    onSavingChange?.(false)
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save()
            }}
          />
          {readOnly ? null : (
            <Button size="small" disabled={!changed} loading={saving} onClick={() => void save()}>
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
      <GroupRow
        label={t('Bot 回复进话题')}
        description={
          dm
            ? t('Bot 的回复放进这条消息的话题，主时间线更清爽')
            : t('在群里 @ Bot 时，它的回复放进这条消息的话题，不刷屏')
        }
      >
        <Switch
          aria-label={t('Bot 回复进话题')}
          disabled={readOnly}
          loading={threadBusy}
          checked={!!group.botRepliesInThread}
          onChange={async (v) => {
            if (threadBusy) return
            setThreadBusy(true)
            await attempt(() => groupsApi.update(group.id, { botRepliesInThread: v }))
            setThreadBusy(false)
          }}
        />
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

/** 入群申请 waiting on the group's admins; a decided one slides out. */
function JoinRequests({ groupId }: { groupId: string }) {
  const [list, setList] = useState<JoinRequestDto[]>([])
  const [busy, setBusy] = useState<{ id: string; ok: boolean } | null>(null)
  const { leaving, leave } = useLeaving()
  const load = () => teamSectionsApi.requests(groupId).then(setList, toastError)
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once per group
  useEffect(() => {
    void load()
  }, [groupId])
  if (!list.length) return null
  const decide = async (r: JoinRequestDto, ok: boolean) => {
    setBusy({ id: r.id, ok })
    if (await attempt(() => teamSectionsApi.decide(r.id, ok))) {
      toast({
        type: 'success',
        message: ok
          ? t('已同意 {name} 入群', { name: r.userName })
          : t('已拒绝 {name}', { name: r.userName }),
      })
      leave(r.id, () => setList((l) => l.filter((x) => x.id !== r.id)))
    }
    setBusy(null)
  }
  return (
    <GroupBox>
      <div className="gs-joins__title">{t('入群申请 · {n}', { n: list.length })}</div>
      {list.map((r) => (
        <GroupRow
          key={r.id}
          className={leaving.has(r.id) ? 'ui-leaving' : undefined}
          label={r.userName}
          description={r.note || undefined}
        >
          <span className="gs-value-line">
            <Button
              size="small"
              variant="primary"
              loading={busy?.id === r.id && busy.ok}
              disabled={!!busy}
              onClick={() => void decide(r, true)}
            >
              {t('同意')}
            </Button>
            <Button
              size="small"
              loading={busy?.id === r.id && !busy.ok}
              disabled={!!busy}
              onClick={() => void decide(r, false)}
            >
              {t('拒绝#reject')}
            </Button>
          </span>
        </GroupRow>
      ))}
    </GroupBox>
  )
}

/** 成员: who may invite and the people; the Bots live with the workspaces. */
function MembersTab({ group, readOnly }: { group: GroupDto; readOnly: boolean }) {
  const teamSections = useTeamSections((s) => s.sections)
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
        {teamSections.length ? (
          <GroupRow
            label={t('团队分区')}
            description={t('团队所有成员都能看到；群管理员可把自己的群归入其中')}
          >
            <PopUpButton<string>
              aria-label={t('团队分区')}
              disabled={readOnly}
              size="small"
              value={group.teamSectionId ?? ''}
              options={[
                { value: '', label: t('不归入') },
                ...teamSections.map((x) => ({ value: x.id, label: x.name })),
              ]}
              onChange={(v) => void attempt(() => teamSectionsApi.file(group.id, v || null))}
            />
          </GroupRow>
        ) : null}
      </GroupBox>
      {!readOnly && group.teamSectionId && group.visibility !== 'public' ? (
        <JoinRequests groupId={group.id} />
      ) : null}
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
function GroupMcpTab({
  group,
  onDirtyChange,
  onSavingChange,
}: {
  group: GroupDto
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
}) {
  const layer = useMcpLayer(`/groups/${group.id}/mcp`)
  useEffect(() => {
    onSavingChange?.(layer.busy)
  }, [layer.busy, onSavingChange])
  useEffect(() => () => onSavingChange?.(false), [onSavingChange])
  return (
    <>
      <div className="gs-note">{t('只对本群生效；与团队层、平台层同名时以群层为准。')}</div>
      <McpLayerList layer={layer} tag={t('群层')} onDirtyChange={onDirtyChange} />
      <McpSaved force={layer.savedForce} />
      <InheritedMcpList groupId={group.id} />
    </>
  )
}

function GroupSkillTab({
  group,
  readOnly,
  onClose,
}: {
  group: GroupDto
  readOnly: boolean
  onClose: () => void
}) {
  const needs = useGet<SecretNeedDto[]>(`/groups/${group.id}/secret-needs`)
  const skills = useGet<unknown[]>(readOnly ? null : `/groups/${group.id}/skills`)
  const installs = useGet<unknown[]>(readOnly ? null : `/groups/${group.id}/installs`)
  const [openSecrets, setOpenSecrets] = useState(false)
  const compactEmpty = !readOnly && skills.data?.length === 0 && (installs.data?.length ?? 0) > 0
  return (
    <>
      {needs.data?.length ? (
        <div className="gs-note">
          {t('本群的 Skill 声明了 {n} 个密钥', { n: new Set(needs.data.map((n) => n.spec.name)).size })}{' '}
          <Button size="small" onClick={() => setOpenSecrets(true)}>
            {t('配置密钥')}
          </Button>
        </div>
      ) : null}
      {readOnly ? (
        <>
          <GroupConfigView groupId={group.id} kind="skill" />
          <InstalledSection base={`/groups/${group.id}`} readOnly />
        </>
      ) : (
        <>
          <div className="gs-note">{t('只对本群生效；与团队层、平台层同名时以群层为准。')}</div>
          <div className={cx(compactEmpty && 'gs-skill--compact')}>
            <SkillLayerList base={`/groups/${group.id}/skills`} tag={t('群层')} />
          </div>
          <InheritedSkillList groupId={group.id} />
          <InstalledSection base={`/groups/${group.id}`} onLeave={onClose} />
        </>
      )}
      <Presence>
        {openSecrets && needs.data ? (
          <NeedsDialog
            groupId={group.id}
            needs={needs.data}
            onClose={() => setOpenSecrets(false)}
            onDone={() => {
              setOpenSecrets(false)
              needs.reload()
            }}
          />
        ) : null}
      </Presence>
    </>
  )
}
