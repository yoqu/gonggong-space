import {
  SYSTEM_PARAM_VIEW,
  TEAM_PARAM_KEYS,
  type TeamDto,
  type TeamGroupDto,
  type TeamParams,
  type TeamParamsDto,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Avatar, Button, Dialog, GroupBox, GroupRow, Presence, Spinner, Stepper, Tag, toast } from '../../ui'
import { AuditPanel } from '../admin/AuditPage'
import { McpLayerList, McpSaved, useMcpLayer } from '../config/ConfigPage'
import { SkillLayerList } from '../config/SkillLayer'
import { UsagePanel } from '../usage/UsagePage'
import { teamsApi } from './store'
import { TakeoverDialog } from './TakeoverDialog'
import '../config/config.css'

/** 团队设置 · MCP: the team layer, over the platform one and under each group's (plan D8). */
export function TeamMcpTab({ team }: { team: TeamDto }) {
  const layer = useMcpLayer(`/teams/${team.id}/mcp`)
  return (
    <>
      <div className="gs-note">
        {t('对本团队所有群生效；与平台层同名时以团队层为准，群管理员可在群设置中再覆盖。')}
      </div>
      <McpLayerList layer={layer} tag={t('团队层')} />
      <McpSaved force={layer.savedForce} />
    </>
  )
}

/** 团队设置 · Skill: the team layer, over the platform one and under each group's. */
export function TeamSkillTab({ team }: { team: TeamDto }) {
  return (
    <>
      <div className="gs-note">
        {t('对本团队所有群生效；与平台层同名时以团队层为准，群管理员可在群设置中再覆盖。')}
      </div>
      <SkillLayerList base={`/teams/${team.id}/skills`} tag={t('团队层')} />
    </>
  )
}

const VIEW = new Map(SYSTEM_PARAM_VIEW.map((v) => [v.key, v]))

/** 团队设置 · 参数: the team's overrides; empty fields inherit the platform value shown as placeholder (plan D9). */
export function TeamParamsTab({ team }: { team: TeamDto }) {
  const { data } = useGet<TeamParamsDto>(`/teams/${team.id}/params`)
  const [draft, setDraft] = useState<TeamParams | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (data) setDraft(data.overrides)
  }, [data])
  if (!data || !draft) return <Spinner />
  const dirty = TEAM_PARAM_KEYS.some((k) => draft[k] !== data.overrides[k])
  const save = async () => {
    setBusy(true)
    if (await attempt(() => teamsApi.update(team.id, { params: draft })))
      toast({ type: 'success', message: t('团队参数已保存') })
    setBusy(false)
  }
  return (
    <>
      <GroupBox>
        {TEAM_PARAM_KEYS.map((key) => {
          const view = VIEW.get(key)
          const label = view ? t.text({ key: view.label }) : key
          const unit = view ? t.text({ key: view.unit }) : ''
          return (
            <GroupRow
              key={key}
              label={label}
              description={
                draft[key] === undefined
                  ? t('继承平台值 {value}', { value: `${data.platform[key]} ${unit}` })
                  : undefined
              }
            >
              {draft[key] === undefined ? null : (
                <Button
                  variant="plain"
                  size="small"
                  aria-label={t('{name}：恢复继承', { name: label })}
                  onClick={() =>
                    setDraft(Object.fromEntries(Object.entries(draft).filter(([k]) => k !== key)))
                  }
                >
                  {t('恢复继承')}
                </Button>
              )}
              <Stepper
                aria-label={label}
                unit={unit}
                min={1}
                width={80}
                placeholder={String(data.platform[key])}
                value={draft[key] ?? null}
                onChange={(v) => setDraft({ ...draft, [key]: v })}
              />
            </GroupRow>
          )
        })}
      </GroupBox>
      <div className="team-actions">
        <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {t('保存')}
        </Button>
      </div>
      <div className="gs-foot">
        {t('留空沿用平台默认值；群管理员可在群设置中再调整群级参数。保存后对新会话生效。')}
      </div>
    </>
  )
}

/** 团队设置 · 群: every group of the team; admins open theirs, view or take over the others (plan D19). */
export function TeamGroupsTab({ team, onClose }: { team: TeamDto; onClose: () => void }) {
  const { data, error } = useGet<TeamGroupDto[]>(`/teams/${team.id}/groups`)
  const navigate = useNavigate()
  const [open, setOpen] = useState<TeamGroupDto | null>(null)
  const [taking, setTaking] = useState<TeamGroupDto | null>(null)
  if (!data) return error ? <div className="gs-note">{error}</div> : <Spinner />
  const go = (id: string) => {
    onClose()
    navigate(`/g/${id}`)
  }
  return (
    <>
      {data.length ? (
        <GroupBox>
          {data.map((g) => (
            <GroupRow
              key={g.id}
              label={
                <span className="team-group__name">
                  {g.name}
                  {g.archivedAt ? <Tag tone="gray">{t('已归档')}</Tag> : null}
                </span>
              }
              description={t('{members} 位成员 · {bots} 个 Bot', { members: g.members, bots: g.bots })}
            >
              <Button variant="plain" size="small" onClick={() => setOpen(g)}>
                {t('查看成员')}
              </Button>
              {g.archivedAt ? null : g.joined ? (
                <Button variant="plain" size="small" onClick={() => go(g.id)}>
                  {t('打开')}
                </Button>
              ) : (
                <>
                  <Button variant="plain" size="small" onClick={() => go(g.id)}>
                    {t('查看')}
                  </Button>
                  <Button variant="plain" size="small" onClick={() => setTaking(g)}>
                    {t('进群并成为管理员')}
                  </Button>
                </>
              )}
            </GroupRow>
          ))}
        </GroupBox>
      ) : (
        <div className="gs-note">{t('团队里还没有群')}</div>
      )}
      <Presence>
        {open ? (
          <Dialog
            open
            title={t('「{name}」的成员', { name: open.name })}
            width={420}
            onClose={() => setOpen(null)}
            actions={[
              { label: t('完成'), variant: 'primary', onClick: () => setOpen(null), autoFocus: true },
            ]}
          >
            <GroupBox>
              {open.memberNames.map((name) => (
                <GroupRow key={name} label={name}>
                  <Avatar name={name} size={22} />
                </GroupRow>
              ))}
            </GroupBox>
          </Dialog>
        ) : taking ? (
          <TakeoverDialog
            teamId={team.id}
            group={taking}
            onDone={() => go(taking.id)}
            onClose={() => setTaking(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}

/** 团队设置 · 用量: every bot of the team, last 30 days. */
export function TeamUsageTab({ team }: { team: TeamDto }) {
  return <UsagePanel teamId={team.id} />
}

/** 团队设置 · 审计: the team's own rows (audit_logs.team_id). */
export function TeamAuditTab({ team }: { team: TeamDto }) {
  return <AuditPanel base={`/teams/${team.id}/audit`} />
}
