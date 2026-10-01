import { SYSTEM_PARAM_VIEW, type SystemParams } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { Alert, Button, GroupBox, GroupRow, Spinner, Stepper, Switch, toast } from '../../ui'
import { AdminPage } from './AdminPage'

type Key = (typeof SYSTEM_PARAM_VIEW)[number]['key']

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
    title: t('同步与锁'),
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

  async function setRegistration(registrationOpen: boolean) {
    try {
      const next = await api.put<SystemParams>('/admin/params', { registrationOpen })
      setSaved((s) => (s ? { ...s, registrationOpen: next.registrationOpen } : next))
      toast({ type: 'success', message: registrationOpen ? t('已开放自助注册') : t('已关闭自助注册') })
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
    <AdminPage title={t('系统参数')} desc={t('全局默认值；群级参数由群管理员在群设置中调整。')}>
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
                onChange={(v) => void setRegistration(v)}
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
