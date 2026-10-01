import type { CreatedPreviewShare, PreviewDto, PreviewShareDto } from '@gonggong/protocol'
import { PREVIEW_SHARE_DEFAULT_DAYS } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { dateLocale } from '../../lib/time'
import { Button, Dialog, GroupBox, PopUpButton, Tag, TextField } from '../../ui'

const DAYS = [1, 3, 7, 30].map((d) => ({ value: String(d), label: t('{n} 天', { n: d }) }))

export const shareState = (s: PreviewShareDto) =>
  s.revokedAt
    ? t('已收回')
    : s.active
      ? t('有效')
      : Date.parse(s.expiresAt) <= Date.now()
        ? t('已过期')
        : t('预览已关闭')

const when = (iso: string) => new Date(iso).toLocaleString(dateLocale)

/** Public links of one preview (plan P8): always expiring; the full link is shown once, right after creating it. */
export function ShareDialog({ preview, onClose }: { preview: PreviewDto; onClose: () => void }) {
  const [shares, setShares] = useState<PreviewShareDto[] | null>(null)
  const [days, setDays] = useState(String(PREVIEW_SHARE_DEFAULT_DAYS))
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(
    () =>
      api
        .get<PreviewShareDto[]>(`/previews/${preview.id}/shares`)
        .then(setShares)
        .catch((e) => toastError(e)),
    [preview.id],
  )
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
  const revoke = async (s: PreviewShareDto) => {
    try {
      await api.post(`/preview-shares/${s.id}/revoke`)
      await load()
    } catch (e) {
      toastError(e)
    }
  }
  const copy = () =>
    created && void copyWithToast(created, t('已复制公开链接'), t('复制失败，请手动选择链接'))
  return (
    <Dialog
      open
      title={t('公开链接 · {title}', { title: preview.title })}
      message={t('拿到链接的人无需登录即可访问这个预览，到期或收回后立即失效；访问会记入审计。')}
      width={520}
      onClose={onClose}
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
      {shares?.length ? (
        <GroupBox>
          {shares.map((s) => (
            <div key={s.id} className="pv-share__row">
              <span className="pv-share__main">
                <Tag tone={s.active ? 'green' : 'gray'}>{shareState(s)}</Tag>
                <span className="pv-muted">
                  {t('{name} 生成 · {expires} 到期 · 访问 {n} 次', {
                    name: s.createdByName,
                    expires: when(s.expiresAt),
                    n: s.visitCount,
                  })}
                </span>
              </span>
              {s.active ? (
                <Button variant="plain" size="small" onClick={() => void revoke(s)}>
                  {t('收回')}
                </Button>
              ) : null}
            </div>
          ))}
        </GroupBox>
      ) : null}
    </Dialog>
  )
}
