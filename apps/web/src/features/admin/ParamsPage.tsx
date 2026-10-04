import { SYSTEM_PARAM_VIEW, type SystemParams } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import {
  Alert,
  Button,
  GroupBox,
  GroupRow,
  SegmentedControl,
  Spinner,
  Stepper,
  Switch,
  toast,
} from '../../ui'
import { AdminPage } from './AdminPage'

type Key = (typeof SYSTEM_PARAM_VIEW)[number]['key']
type Toggle = 'registrationOpen' | 'singleTeamMode' | 'teamCreation' | 'demoMode'

/** GET /api/admin/params; null until loaded (or when it fails — callers only use it for auxiliary copy). */
export function useSystemParams(enabled = true) {
  const [params, setParams] = useState<SystemParams | null>(null)
  useEffect(() => {
    if (!enabled) return
    api
      .get<SystemParams>('/admin/params')
      .then(setParams)
      .catch(() => {})
  }, [enabled])
  return params
}

type Values = Record<Key, number | null>
const toForm = (p: SystemParams) =>
  Object.fromEntries(SYSTEM_PARAM_VIEW.map(({ key }) => [key, p[key]])) as Values
/** Step (and so displayed precision) per param; everything else is a whole number. */
const STEP: Partial<Record<Key, number>> = { forceSyncMinBandwidthMbps: 0.1 }

const SECTIONS: { title: string; keys: Key[] }[] = [
  {
    title: t('同步'),
    keys: ['writerDisconnectReleaseSec', 'forceSyncMaxLatencyMs', 'forceSyncMinBandwidthMbps'],
  },
  { title: t('运行与会话'), keys: ['sessionReplayCount', 'contextInlineMax', 'questionsPerCard'] },
  { title: t('附件#nav'), keys: ['attachmentMaxMb', 'attachmentsPerMessage'] },
  { title: t('机器连接'), keys: ['heartbeatSec', 'offlineMisses'] },
  { title: t('数据保留'), keys: ['runRetentionDays', 'backupRetentionDays', 'archiveRetentionDays'] },
  {
    title: t('群与 Bot 默认值'),
    keys: ['approvalTimeoutMin', 'chainMaxHops', 'offlineWaitMin', 'botConcurrencyDefault'],
  },
]
const listed = new Set(SECTIONS.flatMap((g) => g.keys))
const unlisted = SYSTEM_PARAM_VIEW.filter((v) => !listed.has(v.key)).map((v) => v.key)
const GROUPS = unlisted.length ? [...SECTIONS, { title: t('其他'), keys: unlisted }] : SECTIONS
const VIEW = new Map(SYSTEM_PARAM_VIEW.map((v) => [v.key, v]))

/** 管理后台 · 系统参数 (spec §10): system-wide defaults; group admins override the group-level ones. */
export function ParamsPage() {
  const [saved, setSaved] = useState<SystemParams | null>(null)
  const [form, setForm] = useState<Values | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = (p: SystemParams) => {
    setSaved(p)
    setForm(toForm(p))
  }
  useEffect(() => {
    api
      .get<SystemParams>('/admin/params')
      .then((p) => {
        setSaved(p)
        setForm(toForm(p))
      })
      .catch((e) => setError(errorText(e)))
  }, [])

  const changed = saved && form ? SYSTEM_PARAM_VIEW.filter(({ key }) => form[key] !== saved[key]) : []
  const dirty = changed.length > 0

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Switches apply at once, apart from the numeric form. */
  async function apply(patch: Partial<Pick<SystemParams, Toggle>>, message: string) {
    try {
      const next = await api.put<SystemParams>('/admin/params', patch)
      const keys = Object.keys(patch) as Toggle[]
      setSaved((s) => (s ? { ...s, ...Object.fromEntries(keys.map((k) => [k, next[k]])) } : next))
      toast({ type: 'success', message })
    } catch (err) {
      toastError(err)
    }
  }

  async function save() {
    if (!form) return
    const patch = Object.fromEntries(changed.map(({ key }) => [key, form[key]]))
    setBusy(true)
    setError('')
    try {
      reset(await api.put<SystemParams>('/admin/params', patch))
      toast({ type: 'success', message: t('系统参数已保存，已写入审计记录') })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminPage
      title={t('系统参数')}
      desc={t('平台默认值；团队管理员可在团队设置中覆盖部分参数，群管理员再在群设置中调整群级参数。')}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {saved ? (
        <section className="admin-params">
          <h2 className="admin-params__title">{t('账号')}</h2>
          <GroupBox>
            <GroupRow
              label={t('开放自助注册')}
              description={t('开启后登录页显示注册入口，注册即成为普通成员；关闭后只能由管理员创建账号。')}
            >
              <Switch
                ariaLabel={t('开放自助注册')}
                label={saved.registrationOpen ? t('已开放') : t('已关闭#off')}
                checked={saved.registrationOpen}
                onChange={(v) =>
                  void apply({ registrationOpen: v }, v ? t('已开放自助注册') : t('已关闭自助注册'))
                }
              />
            </GroupRow>
          </GroupBox>
          <h2 className="admin-params__title">{t('团队')}</h2>
          <GroupBox>
            <GroupRow
              label={t('单团队模式')}
              description={t(
                '开启后不显示团队切换，新账号自动加入唯一的团队；仅在恰好有一个未归档团队时可开启。',
              )}
            >
              <Switch
                ariaLabel={t('单团队模式')}
                label={saved.singleTeamMode ? t('已开启') : t('已关闭#off')}
                checked={saved.singleTeamMode}
                onChange={(v) =>
                  void apply({ singleTeamMode: v }, v ? t('已开启单团队模式') : t('已关闭单团队模式'))
                }
              />
            </GroupRow>
            <GroupRow label={t('建团队权限')} description={t('单团队模式下任何人都不能新建团队。')}>
              <SegmentedControl
                aria-label={t('建团队权限')}
                size="small"
                value={saved.teamCreation}
                onChange={(v) => void apply({ teamCreation: v }, t('建团队权限已保存'))}
                items={[
                  { value: 'all' as const, label: t('所有人') },
                  { value: 'sysadmin' as const, label: t('仅系统管理员') },
                ]}
              />
            </GroupRow>
          </GroupBox>
          <h2 className="admin-params__title">{t('演示')}</h2>
          <GroupBox>
            <GroupRow
              label={t('演示模式')}
              description={t(
                '对外公开演示时开启，防止内容经内网穿透的域名流到互联网、访客破坏演示环境：预览只能登录后在群内查看，不能创建公开链接，已发出的公开链接立即失效，预览卡片不同步到飞书；实时画面只能观看不能操控；Bot 不能使用「完全访问」档位，已设为完全访问的按「工作区写入」运行；除系统管理员外不能改密码和昵称，不能解散群、移除成员、删除 Bot、吊销机器、归档团队。',
              )}
            >
              <Switch
                ariaLabel={t('演示模式')}
                label={saved.demoMode ? t('已开启') : t('已关闭#off')}
                checked={saved.demoMode}
                onChange={(v) => void apply({ demoMode: v }, v ? t('已开启演示模式') : t('已关闭演示模式'))}
              />
            </GroupRow>
          </GroupBox>
        </section>
      ) : null}
      {saved && form ? (
        GROUPS.map((g) => (
          <section key={g.title} className="admin-params">
            <h2 className="admin-params__title">{g.title}</h2>
            <GroupBox>
              {g.keys.map((key) => {
                const { label, unit } = VIEW.get(key) as (typeof SYSTEM_PARAM_VIEW)[number]
                const edited = changed.some((c) => c.key === key)
                return (
                  <GroupRow
                    key={key}
                    className={cx('admin-param', edited && 'is-dirty')}
                    label={
                      <span className="admin-param__label">
                        {edited ? <span className="admin-param__dot" title={t('已修改')} /> : null}
                        {label}
                      </span>
                    }
                  >
                    <Stepper
                      aria-label={label}
                      unit={unit}
                      min={0}
                      step={STEP[key] ?? 1}
                      width={80}
                      value={form?.[key] ?? null}
                      onChange={(v) => setForm((f) => f && { ...f, [key]: v })}
                    />
                  </GroupRow>
                )
              })}
            </GroupBox>
          </section>
        ))
      ) : error ? null : (
        <Spinner size={18} />
      )}
      {dirty && saved ? (
        <section className="admin-savebar" aria-label={t('未保存的修改')}>
          <span className="admin-param__dot" />
          <span>{t('已修改 {n} 项', { n: changed.length })}</span>
          <span className="spacer" />
          <Button disabled={busy} onClick={() => reset(saved)}>
            {t('放弃')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {t('保存')}
          </Button>
        </section>
      ) : null}
    </AdminPage>
  )
}
