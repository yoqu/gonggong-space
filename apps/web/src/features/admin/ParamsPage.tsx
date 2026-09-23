import { SYSTEM_PARAM_VIEW, type SystemParams } from '@aiws/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, Button, Input, Spinner, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { AdminPage } from './AdminPage'

type Key = keyof SystemParams

/** GET /api/admin/params; null until loaded (or when it fails — callers only use it for auxiliary copy). */
export function useSystemParams() {
  const [params, setParams] = useState<SystemParams | null>(null)
  useEffect(() => {
    api
      .get<SystemParams>('/admin/params')
      .then(setParams)
      .catch(() => {})
  }, [])
  return params
}

const text = (v: number | null) => (v === null ? '' : String(v))
const toForm = (p: SystemParams) =>
  Object.fromEntries(SYSTEM_PARAM_VIEW.map(({ key }) => [key, text(p[key])]))

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

  async function save() {
    if (!saved) return
    const patch: Partial<Record<Key, number | null>> = {}
    for (const { key, label } of SYSTEM_PARAM_VIEW) {
      const raw = form[key]?.trim() ?? ''
      if (raw === text(saved[key])) continue
      const value = raw === '' ? null : Number(raw)
      if (value !== null && Number.isNaN(value)) return setError(`「${label}」需要填写数字`)
      patch[key] = value
    }
    if (!Object.keys(patch).length) return toast({ type: 'info', message: '没有修改' })
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
    <AdminPage
      title="系统参数"
      desc="全局默认值；群级参数由群管理员在群设置中调整。"
      actions={
        <Button variant="primary" disabled={!saved || busy} onClick={() => void save()}>
          保存
        </Button>
      }
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {saved ? (
        <div className="admin-list">
          {SYSTEM_PARAM_VIEW.map(({ key, label, unit, measure }) => (
            <div key={key} className="admin-param">
              <span>{label}</span>
              <span className="admin-param__value">
                <Input
                  size="sm"
                  inputMode="decimal"
                  aria-label={label}
                  className={
                    measure ? 'admin-param__input admin-param__input--measure' : 'admin-param__input'
                  }
                  value={form[key] ?? ''}
                  placeholder="待定"
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
                <span className="admin-param__unit">{unit}</span>
              </span>
              <span
                className={measure ? 'admin-param__note admin-param__note--measure' : 'admin-param__note'}
              >
                {measure ? '需实测' : ''}
              </span>
            </div>
          ))}
        </div>
      ) : error ? null : (
        <Spinner size={18} />
      )}
    </AdminPage>
  )
}
