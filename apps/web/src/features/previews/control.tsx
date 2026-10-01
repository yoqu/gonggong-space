import type { ControlReq, PreviewDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { Button, Tag } from '../../ui'
import './live.css'

const act = (previewId: string, body: ControlReq) =>
  attempt(() => api.post(`/previews/${previewId}/control`, body))

/** Members waiting for control, for the bot owner or a group admin to approve (plan P14). */
export function ControlRequests({ preview: p }: { preview: PreviewDto }) {
  if (!p.canManage || !p.control?.requests.length) return null
  return (
    <div className="lv-requests">
      {p.control.requests.map((r) => (
        <div key={r.id} className="lv-request">
          <span className="lv-request__who">{t('{name} 请求控制', { name: r.name })}</span>
          <Button
            size="small"
            variant="primary"
            onClick={() => void act(p.id, { action: 'grant', userId: r.id })}
          >
            {t('同意')}
          </Button>
          <Button
            size="small"
            variant="plain"
            onClick={() => void act(p.id, { action: 'deny', userId: r.id })}
          >
            {t('拒绝')}
          </Button>
        </div>
      ))}
    </div>
  )
}

/** Who controls, and this member's way to take, ask for or give back control. */
export function ControlBar({ preview: p, me }: { preview: PreviewDto; me: string | undefined }) {
  const c = p.control
  if (!c) return null
  const mine = !!me && c.controller?.id === me
  const asked = c.requests.some((r) => r.id === me)
  return (
    <div className="lv-control">
      {mine ? (
        <>
          <Tag tone="blue" icon="hand">
            {t('你正在控制')}
          </Tag>
          <Button size="small" onClick={() => void act(p.id, { action: 'release' })}>
            {t('交还控制')}
          </Button>
        </>
      ) : (
        <>
          <span className="lv-control__who">
            {c.controller ? t('{name} 正在控制', { name: c.controller.name }) : t('仅观看')}
          </span>
          {p.canManage ? (
            <>
              <Button size="small" icon="hand" onClick={() => void act(p.id, { action: 'request' })}>
                {c.controller ? t('接管控制') : t('开始控制')}
              </Button>
              {c.controller ? (
                <Button size="small" variant="plain" onClick={() => void act(p.id, { action: 'revoke' })}>
                  {t('收回控制')}
                </Button>
              ) : null}
            </>
          ) : asked ? (
            <Button size="small" variant="plain" onClick={() => void act(p.id, { action: 'release' })}>
              {t('取消请求')}
            </Button>
          ) : (
            <Button size="small" icon="hand" onClick={() => void act(p.id, { action: 'request' })}>
              {t('请求控制')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
