import type { FeishuAppDto, FeishuAppStatus, FeishuAppView } from '@gonggong/protocol'
import { lazy, Suspense, useState } from 'react'
import { locale, t } from '../../i18n'
import { api, errorText } from '../../lib/api'
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
import { FeishuAppSteps, useFeishuApp } from './FeishuAppSteps'
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
 * leaving it empty keeps showing the saved app, filling both replaces it. `blocked` says why scanning must wait.
 */
export function FeishuAppForm({
  path,
  removeLabel,
  blocked,
  onChange,
}: {
  path: string
  removeLabel: string
  blocked?: string
  /** After the app was saved, removed, scanned or its config retried. */
  onChange?: () => void
}) {
  const feishu = useFeishuApp(path)
  const { app, retrying } = feishu
  const reload = () => {
    feishu.reload()
    onChange?.()
  }
  const retry = () => feishu.retry().then(onChange)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const [scan, setScan] = useState<'create' | 'update' | null>(null)

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

  return (
    <div className="feishu-app">
      {app ? <FeishuAppStatusLine app={app} /> : <span className="feishu-app__unset">{t('未配置')}</span>}
      {app ? <FeishuAppSteps app={app} retrying={retrying} onRetry={() => void retry()} /> : null}
      <div className="feishu-app__actions">
        <Button size="small" variant="primary" disabled={!!blocked} onClick={() => setScan('create')}>
          {t('扫码创建或接入')}
        </Button>
        {app ? (
          <Button size="small" variant="plain" disabled={!!blocked} onClick={() => setScan('update')}>
            {t('更新权限')}
          </Button>
        ) : null}
        {blocked ? <span className="feishu-app__blocked">{blocked}</span> : null}
        <span className="feishu-app__or">{t('或手动填写已有应用的凭证')}</span>
        <a className="feishu-app__guide" href={GUIDE} target="_blank" rel="noreferrer">
          {t('飞书后台配置说明')}
        </a>
      </div>
      <div className="feishu-app__fields">
        <TextField
          aria-label="App ID"
          placeholder={app ? app.appId : 'cli_…'}
          autoComplete="off"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        />
        <SecureField
          aria-label="App Secret"
          placeholder={app ? t('留空保持不变') : 'App Secret'}
          autoComplete="new-password"
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
          {app ? t('更换') : t('接入#verb')}
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
