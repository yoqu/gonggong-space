import {
  type CreatedPreviewShare,
  PREVIEW_SHARE_DEFAULT_DAYS,
  type PreviewDto,
  type PreviewShareDto,
} from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { localDateTime } from '../../lib/time'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  Dialog,
  GroupBox,
  PopUpButton,
  Presence,
  Spinner,
  Tag,
  TextField,
} from '../../ui'

const DAYS = [1, 3, 7, 30].map((d) => ({ value: String(d), label: t('{n} 天', { n: d }) }))

/** 收回 a public link: the same confirmation in the preview's share dialog and in 管理后台 · 公开链接. */
export function RevokeShareDialog({
  title,
  shareId,
  onDone,
  onClose,
}: {
  title: string
  shareId: string
  onDone: () => void
  onClose: () => void
}) {
  return (
    <ConfirmActionDialog
      title={t('要收回公开链接「{title}」吗？', { title })}
      message={t('收回后该链接立即失效，外部访客将无法继续打开此预览。')}
      consequences={[t('原链接无法恢复，如需外部分享需重新生成公开链接')]}
      label={t('收回')}
      done={t('已收回公开链接')}
      run={() => api.post(`/preview-shares/${shareId}/revoke`)}
      onDone={onDone}
      onClose={onClose}
    />
  )
}

export const shareState = (s: PreviewShareDto) =>
  s.revokedAt
    ? t('已收回')
    : s.active
      ? t('有效')
      : Date.parse(s.expiresAt) <= Date.now()
        ? t('已过期')
        : t('预览已关闭')

/** Public links of one preview (plan P8): always expiring; the full link is shown once, right after creating it. */
export function ShareDialog({ preview, onClose }: { preview: PreviewDto; onClose: () => void }) {
  const [shares, setShares] = useState<PreviewShareDto[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [days, setDays] = useState(String(PREVIEW_SHARE_DEFAULT_DAYS))
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revoking, setRevoking] = useState<PreviewShareDto | null>(null)
  const load = useCallback(() => {
    setLoadError('')
    return api
      .get<PreviewShareDto[]>(`/previews/${preview.id}/shares`)
      .then((list) => {
        setShares(list)
        setLoadError('')
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : t('加载失败')))
  }, [preview.id])
  useEffect(() => void load(), [load])
  const create = async () => {
    setBusy(true)
    try {
      const res = await api.post<CreatedPreviewShare>(`/previews/${preview.id}/shares`, {
        days: Number(days),
      })
      setCreated(res.url)
      await load()
    } catch (e) {
      toastError(e)
    }
    setBusy(false)
  }
  const copy = () =>
    created && void copyWithToast(created, t('已复制公开链接'), t('复制失败，请手动选择链接'))
  return (
    <Dialog
      open
      title={t('公开链接 · {title}', { title: preview.title })}
      message={t('拿到链接的人无需登录即可访问这个预览，到期或收回后立即失效；访问会记入审计。')}
      width={520}
      onClose={busy ? () => {} : onClose}
    >
      <div className="pv-share__create">
        <PopUpButton aria-label={t('有效期')} size="small" value={days} options={DAYS} onChange={setDays} />
        <Button variant="primary" size="small" loading={busy} onClick={() => void create()}>
          {t('生成链接')}
        </Button>
      </div>
      {created ? (
        <div className="pv-share__url">
          <TextField aria-label={t('公开链接')} value={created} readOnly onFocus={(e) => e.target.select()} />
          <Button size="small" icon="copy" onClick={() => void copy()}>
            {t('复制')}
          </Button>
        </div>
      ) : null}
      {loadError && !shares ? (
        <Alert variant="error" title={t('加载失败')} description={loadError} onRetry={() => void load()} />
      ) : shares === null ? (
        <Spinner size={14} />
      ) : shares.length ? (
        <GroupBox>
          {shares.map((s) => (
            <div key={s.id} className="pv-share__row">
              <span className="pv-share__main">
                <Tag tone={s.active ? 'green' : 'gray'}>{shareState(s)}</Tag>
                <span className="pv-muted">
                  {t('{name} 生成 · {expires} 到期 · 访问 {n} 次', {
                    name: s.createdByName,
                    expires: localDateTime(s.expiresAt),
                    n: s.visitCount,
                  })}
                </span>
              </span>
              {s.active ? (
                <Button variant="plain" size="small" onClick={() => setRevoking(s)}>
                  {t('收回')}
                </Button>
              ) : null}
            </div>
          ))}
        </GroupBox>
      ) : (
        <span className="pv-muted">{t('还没有公开链接')}</span>
      )}
      <Presence>
        {revoking ? (
          <RevokeShareDialog
            title={preview.title}
            shareId={revoking.id}
            onDone={() => {
              setRevoking(null)
              void load()
            }}
            onClose={() => setRevoking(null)}
          />
        ) : null}
      </Presence>
    </Dialog>
  )
}
