import type { FeishuAppDto, FeishuAppStatus, FeishuAppView } from '@gonggong/protocol'
import { lazy, Suspense, useEffect, useState } from 'react'
import { locale, t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  Presence,
  SecureField,
  Tag,
  type TagTone,
  TextField,
  toast,
} from '../../ui'
import './feishu.css'

// The QR code library is only needed once someone scans.
const FeishuScanDialog = lazy(() =>
  import('./FeishuScanDialog').then((m) => ({ default: m.FeishuScanDialog })),
)

const GUIDE = `https://yoqu.github.io/gonggong-space/${locale === 'en' ? 'en/' : ''}admin/feishu`

const STATUS: Record<FeishuAppStatus, { label: string; tone: TagTone }> = {
  connecting: { label: t('连接中'), tone: 'blue' },
  connected: { label: t('已连接'), tone: 'green' },
  error: { label: t('连接失败'), tone: 'red' },
}

/** Connection state and its error, the one place a Feishu app's problems show up. */
export function FeishuAppStatusLine({ app }: { app: FeishuAppDto }) {
  const s = STATUS[app.status]
  return (
    <div className="feishu-app__status">
      <Tag tone={s.tone}>{s.label}</Tag>
      <span className="feishu-app__id">{app.appId}</span>
      {app.error ? <Alert variant="error" description={app.error} /> : null}
    </div>
  )
}

/**
 * App ID / App Secret of one Feishu app at `path` (GET/PUT/DELETE FeishuAppView). The secret is write-only:
 * leaving it empty keeps showing the saved app, filling both replaces it.
 */
export function FeishuAppForm({ path, removeLabel }: { path: string; removeLabel: string }) {
  const { data, reload } = useGet<FeishuAppView>(path)
  const app = data?.app ?? null
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const [scan, setScan] = useState<'create' | 'update' | null>(null)
  const [retrying, setRetrying] = useState(false)

  // A fresh connection reports in within seconds.
  useEffect(() => {
    if (app?.status !== 'connecting') return
    const timer = setTimeout(reload, 3000)
    return () => clearTimeout(timer)
  }, [app, reload])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api.put<FeishuAppView>(path, { appId: appId.trim(), appSecret: appSecret.trim() })
      setAppId('')
      setAppSecret('')
      reload()
      toast({ type: 'success', message: t('飞书应用已保存') })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    setRetrying(true)
    try {
      await api.post<FeishuAppView>(`${path}/configure`, {})
      reload()
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="feishu-app">
      {app ? <FeishuAppStatusLine app={app} /> : <span className="feishu-app__unset">{t('未配置')}</span>}
      {app?.configError ? (
        <Alert
          variant="warning"
          title={app.configError}
          description={t('缺权限时点「更新权限」扫码补齐；飞书管理员审核通过后会自动完成，也可以现在重试。')}
        >
          <Button size="small" disabled={retrying} onClick={() => void retry()}>
            {t('重试自动配置')}
          </Button>
        </Alert>
      ) : null}
      <div className="feishu-app__actions">
        <Button size="small" variant="primary" onClick={() => setScan('create')}>
          {t('扫码创建或绑定')}
        </Button>
        {app ? (
          <Button size="small" variant="plain" onClick={() => setScan('update')}>
            {t('更新权限')}
          </Button>
        ) : null}
        <span className="feishu-app__or">{t('或手动填写已有应用的凭证')}</span>
        <a className="feishu-app__guide" href={GUIDE} target="_blank" rel="noreferrer">
          {t('飞书后台配置说明')}
        </a>
      </div>
      <div className="feishu-app__fields">
        <TextField
          aria-label="App ID"
          placeholder={app ? app.appId : 'cli_…'}
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        />
        <SecureField
          aria-label="App Secret"
          placeholder={app ? t('留空保持不变') : 'App Secret'}
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
        />
      </div>
      {error ? <Alert variant="error" description={error} /> : null}
      <div className="feishu-app__actions">
        <Button
          size="small"
          disabled={busy || !appId.trim() || !appSecret.trim()}
          onClick={() => void save()}
        >
          {app ? t('更换') : t('绑定#verb')}
        </Button>
        {app ? (
          <Button size="small" variant="plain" onClick={() => setRemoving(true)}>
            {removeLabel}
          </Button>
        ) : null}
      </div>
      <Presence>
        {scan ? (
          <Suspense fallback={null}>
            <FeishuScanDialog
              path={path}
              update={scan === 'update'}
              onClose={() => setScan(null)}
              onDone={reload}
            />
          </Suspense>
        ) : null}
      </Presence>
      <Presence>
        {removing ? (
          <ConfirmActionDialog
            title={removeLabel}
            message={t('确定移除飞书应用 {appId}？', { appId: app?.appId ?? '' })}
            consequences={[
              t('断开该应用的长连接，飞书里将无法再使用它'),
              t('飞书开发者后台中的应用不受影响'),
            ]}
            label={t('移除')}
            done={t('已移除飞书应用')}
            run={() => api.del(path).then(reload)}
            onClose={() => setRemoving(false)}
          />
        ) : null}
      </Presence>
    </div>
  )
}
