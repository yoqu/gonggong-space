import type { MarketListingDetailDto, MarketListingDto, ReviewStatus } from '@gonggong/protocol'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { Alert, GroupBox, GroupRow, Link, Spinner, Tag } from '../../ui'
import { fmtSize } from '../attachments/api'
import { Markdown } from '../chat/Markdown'
import { TYPE_LABEL } from './InstallList'
import '../config/config.css'
import './market.css'

export const SOURCE_LABEL: Record<MarketListingDto['source'], string> = {
  official: t('官方'),
  team: t('本团队'),
  public: t('公开'),
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  draft: t('草稿'),
  pending: t('待审核'),
  approved: t('已通过'),
  rejected: t('已驳回'),
}
const REVIEW_TONE = { draft: 'gray', pending: 'orange', approved: 'green', rejected: 'red' } as const

export const ReviewTag = ({ status }: { status: ReviewStatus }) => (
  <Tag tone={REVIEW_TONE[status]}>{REVIEW_LABEL[status]}</Tag>
)

/** `作者 · 团队`, or 官方 for platform listings. */
export const byline = (l: Pick<MarketListingDto, 'author' | 'teamName' | 'source'>) =>
  [l.author, l.teamName].filter(Boolean).join(' · ') || SOURCE_LABEL[l.source]

/**
 * One listing: meta, README, files, version history and the GitHub source. `versionId` asks for that version's
 * content (a reviewer looking at a pending one).
 */
export function ListingDetail({
  id,
  versionId,
  actions,
}: {
  id: string
  versionId?: string
  actions?: (d: MarketListingDetailDto) => ReactNode
}) {
  const { data, error } = useGet<MarketListingDetailDto>(
    `/market/${id}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`,
  )
  if (!data) return error ? <Alert variant="error" title={error} /> : <Spinner />
  const gh = data.ghSource
  return (
    <div className="mkt-detail">
      <div className="mkt-detail__meta">
        <Tag tone="blue">{TYPE_LABEL[data.type]}</Tag>
        <Tag tone="gray">{SOURCE_LABEL[data.source]}</Tag>
        {data.agents.map((a) => (
          <Tag key={a}>{a}</Tag>
        ))}
        <span className="mkt-detail__by">
          {t('{by} · {n} 次引入 · r{rev}', { by: byline(data), n: data.installs, rev: data.listedRevision })}
        </span>
        {actions ? <span className="mkt-detail__actions">{actions(data)}</span> : null}
      </div>
      {data.description ? <p className="mkt-detail__desc">{data.description}</p> : null}
      {gh ? (
        <div className="mkt-detail__gh">
          {t('来源')}{' '}
          <Link external href={gh.url}>
            {[gh.url, gh.ref, gh.path].filter(Boolean).join(' · ')}
          </Link>{' '}
          <code className="gs-mono">@{gh.commit.slice(0, 7)}</code>
        </div>
      ) : null}
      <div className="cfg__eyebrow">{t('说明')}</div>
      <div className="mkt-detail__readme">
        <Markdown text={data.readme} />
      </div>
      <div className="cfg__eyebrow">{t('文件')}</div>
      <GroupBox>
        {data.files.map((f) => (
          <GroupRow key={f.path} label={<code className="gs-mono">{f.path}</code>} value={fmtSize(f.size)} />
        ))}
      </GroupBox>
      <div className="cfg__eyebrow">{t('版本历史')}</div>
      <GroupBox>
        {data.versions.map((v) => (
          <GroupRow
            key={v.id}
            label={
              <span className="cfg__name-line">
                <span className="cfg__name">r{v.revision}</span>
                <ReviewTag status={v.reviewStatus} />
                <span className="mkt-detail__by">
                  {[v.createdBy, new Date(v.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}
                </span>
              </span>
            }
            description={
              <>
                {v.changelog || t('（无更新说明）')}
                {v.reviewNote ? <div>{t('审核意见：{note}', { note: v.reviewNote })}</div> : null}
              </>
            }
          />
        ))}
      </GroupBox>
    </div>
  )
}
