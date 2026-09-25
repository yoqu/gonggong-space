import { SYSTEM_PARAM_VIEW, type SystemParams } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Alert, Button, GroupBox, GroupRow, Input, Spinner, Switch, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'
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

const text = (v: number | null) => (v === null ? '' : String(v))
const toForm = (p: SystemParams) =>
  Object.fromEntries(SYSTEM_PARAM_VIEW.map(({ key }) => [key, text(p[key])]))

const SECTIONS: { title: string; keys: Key[] }[] = [
  {
    title: '同步与锁',
    keys: ['writerDisconnectReleaseSec', 'forceSyncMaxLatencyMs', 'forceSyncMinBandwidthMbps'],
  },
  { title: '运行与会话', keys: ['sessionReplayCount', 'contextInlineMax', 'questionsPerCard'] },
  { title: '附件', keys: ['attachmentMaxMb', 'attachmentsPerMessage'] },
  { title: 'daemon', keys: ['heartbeatSec', 'offlineMisses'] },
  { title: '数据保留', keys: ['runRetentionDays', 'backupRetentionDays', 'archiveRetentionDays'] },
  {
    title: '群与 Bot 默认值',
    keys: ['approvalTimeoutMin', 'chainMaxHops', 'offlineWaitMin', 'botConcurrencyDefault'],
  },
]
const listed = new Set(SECTIONS.flatMap((g) => g.keys))
const unlisted = SYSTEM_PARAM_VIEW.filter((v) => !listed.has(v.key)).map((v) => v.key)
const GROUPS = unlisted.length ? [...SECTIONS, { title: '其他', keys: unlisted }] : SECTIONS
const VIEW = new Map(SYSTEM_PARAM_VIEW.map((v) => [v.key, v]))

/** 管理后台 · 系统参数 (spec §10): system-wide defaults; group admins override the group-level ones. */
export function ParamsPage() {
  const [saved, setSaved] = useState<SystemParams | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
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

  const changed = saved
    ? SYSTEM_PARAM_VIEW.filter(({ key }) => (form[key]?.trim() ?? '') !== text(saved[key]))
    : []
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
      toast({ type: 'success', message: registrationOpen ? '已开放自助注册' : '已关闭自助注册' })
    } catch (err) {
      toast({ type: 'error', message: errorText(err) })
    }
  }

  async function save() {
    if (!saved) return
    const patch: Partial<Record<Key, number | null>> = {}
    for (const { key, label } of changed) {
      const raw = form[key]?.trim() ?? ''
      const value = raw === '' ? null : Number(raw)
      if (value !== null && Number.isNaN(value)) return setError(`「${label}」需要填写数字`)
      patch[key] = value
    }
    setBusy(true)
    setError('')
    try {
      reset(await api.put<SystemParams>('/admin/params', patch))
      toast({ type: 'success', message: '系统参数已保存，已写入审计记录' })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminPage title="系统参数" desc="全局默认值；群级参数由群管理员在群设置中调整。">
      {error ? <Alert variant="error" description={error} /> : null}
      {saved ? (
        <section className="admin-params">
          <h2 className="admin-params__title">账号</h2>
          <GroupBox>
            <GroupRow
              label="开放自助注册"
              description="开启后登录页显示注册入口，注册即成为普通成员；关闭后只能由管理员创建账号。"
            >
              <Switch
                ariaLabel="开放自助注册"
                label={saved.registrationOpen ? '已开放' : '已关闭'}
                checked={saved.registrationOpen}
                onChange={(v) => void setRegistration(v)}
              />
            </GroupRow>
          </GroupBox>
        </section>
      ) : null}
      {saved ? (
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
                        {edited ? <span className="admin-param__dot" title="已修改" /> : null}
                        {label}
                      </span>
                    }
                  >
                    <span className="admin-param__value">
                      <Input
                        inputMode="decimal"
                        aria-label={label}
                        className="admin-param__input"
                        value={form[key] ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      />
                      <span className="admin-param__unit">{unit}</span>
                    </span>
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
        <section className="admin-savebar" aria-label="未保存的修改">
          <span className="admin-param__dot" />
          <span>已修改 {changed.length} 项</span>
          <span className="spacer" />
          <Button disabled={busy} onClick={() => reset(saved)}>
            放弃
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            保存
          </Button>
        </section>
      ) : null}
    </AdminPage>
  )
}
