import type { CreatedPreviewShare, PreviewDto, PreviewShareDto } from '@gonggong/protocol'
import { PREVIEW_SHARE_DEFAULT_DAYS } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Button, Dialog, GroupBox, PopUpButton, Tag, TextField, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'

const DAYS = [1, 3, 7, 30].map((d) => ({ value: String(d), label: `${d} 天` }))

export const shareState = (s: PreviewShareDto) =>
  s.revokedAt ? '已收回' : s.active ? '有效' : Date.parse(s.expiresAt) <= Date.now() ? '已过期' : '预览已关闭'

const when = (iso: string) => new Date(iso).toLocaleString()

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
        .catch((e) => toast({ type: 'error', message: errorText(e) })),
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
      toast({ type: 'error', message: errorText(e) })
    }
    setBusy(false)
  }
  const revoke = async (s: PreviewShareDto) => {
    try {
      await api.post(`/preview-shares/${s.id}/revoke`)
      await load()
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    }
  }
  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created)
      toast({ message: '已复制公开链接' })
    } catch {
      toast({ type: 'error', message: '复制失败，请手动选择链接' })
    }
  }
  return (
    <Dialog
      open
      title={`公开链接 · ${preview.title}`}
      message="拿到链接的人无需登录即可访问这个预览，到期或收回后立即失效；访问会记入审计。"
      width={520}
      onClose={onClose}
    >
      <div className="pv-share__create">
        <PopUpButton aria-label="有效期" size="small" value={days} options={DAYS} onChange={setDays} />
        <Button variant="primary" size="small" loading={busy} onClick={() => void create()}>
          生成链接
        </Button>
      </div>
      {created ? (
        <div className="pv-share__url">
          <TextField aria-label="公开链接" value={created} readOnly onFocus={(e) => e.target.select()} />
          <Button size="small" icon="copy" onClick={() => void copy()}>
            复制
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
                  {s.createdByName} 生成 · {when(s.expiresAt)} 到期 · 访问 {s.visitCount} 次
                </span>
              </span>
              {s.active ? (
                <Button variant="plain" size="small" onClick={() => void revoke(s)}>
                  收回
                </Button>
              ) : null}
            </div>
          ))}
        </GroupBox>
      ) : null}
    </Dialog>
  )
}
