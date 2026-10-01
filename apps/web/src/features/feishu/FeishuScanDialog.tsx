import type { FeishuRegisterDto } from '@gonggong/protocol'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Alert, Dialog, toast } from '../../ui'

const POLL_MS = 1500

/**
 * 扫码创建 / 更新权限 of the Feishu app at `path`: the admin scans the QR in Feishu and confirms there; the server
 * saves the app and sets the long connection (and the main app's redirect URL) by itself.
 */
export function FeishuScanDialog({
  path,
  update,
  onClose,
  onDone,
}: {
  path: string
  update: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [session, setSession] = useState<FeishuRegisterDto | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  const start = useCallback(() => {
    setSession(null)
    setError('')
    api
      .post<FeishuRegisterDto>(`${path}/register`, { update })
      .then(setSession)
      .catch((e) => setError(errorText(e)))
  }, [path, update])

  useEffect(start, [start])

  const id = session?.status === 'waiting' ? session.id : null
  useEffect(() => {
    if (!id) return
    const timer = setInterval(() => {
      setNow(Date.now())
      api
        .get<FeishuRegisterDto>(`/feishu/register/${id}`)
        .then(setSession)
        .catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [id])

  const succeeded = session?.status === 'succeeded'
  useEffect(() => {
    if (!succeeded) return
    onDone()
    if (!session?.configError) {
      toast({ type: 'success', message: t('飞书应用已创建并连接') })
      onClose()
    }
  }, [succeeded, session?.configError, onDone, onClose])

  const cancel = () => {
    if (id) void api.del(`/feishu/register/${id}`).catch(() => {})
    onClose()
  }

  const ended = session && (session.status === 'expired' || session.status === 'failed')
  const left = session ? Math.max(0, Math.round((Date.parse(session.expiresAt) - now) / 1000)) : 0

  return (
    <Dialog
      open
      width={420}
      title={update ? t('更新飞书应用权限') : t('扫码创建飞书应用')}
      message={t('用飞书扫码，确认后自动完成配置')}
      onClose={cancel}
      closeOnBackdrop={false}
      actions={[
        ...(ended ? [{ label: t('重新生成'), onClick: start }] : []),
        {
          label: succeeded ? t('完成') : t('取消'),
          variant: succeeded ? 'primary' : undefined,
          onClick: cancel,
        },
      ]}
    >
      <div className="feishu-scan">
        {error ? <Alert variant="error" description={error} /> : null}
        {session?.status === 'waiting' ? (
          <>
            <QRCodeSVG value={session.url} size={196} marginSize={2} title={t('飞书扫码')} />
            <a href={session.url} target="_blank" rel="noreferrer">
              {t('在飞书中打开')}
            </a>
            <span className="feishu-scan__hint">{t('{n} 秒后过期', { n: String(left) })}</span>
          </>
        ) : null}
        {session?.status === 'expired' ? <Alert variant="warning" description={t('二维码已过期')} /> : null}
        {session?.status === 'failed' ? <Alert variant="error" description={session.error ?? ''} /> : null}
        {succeeded && session.configError ? (
          <Alert
            variant="warning"
            title={session.configError}
            description={t(
              '应用已保存。请在飞书开发者后台手动完成：事件与回调的订阅方式改为长连接；主应用在安全设置中添加重定向 URL。',
            )}
          />
        ) : null}
      </div>
    </Dialog>
  )
}
