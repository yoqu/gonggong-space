import type {
  ListingType,
  ListingVersionDto,
  MarketListingDetailDto,
  MarketListingDto,
  ReviewStatus,
} from '@gonggong/protocol'
import { type ReactNode, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Dialog,
  GroupBox,
  GroupRow,
  Icon,
  Link,
  Presence,
  Spinner,
  Tag,
  TextArea,
  toast,
} from '../../ui'
import { Markdown } from '../chat/Markdown'
import { hasOfficialIcon, OfficialIcon } from '../plugins/OfficialIcon'
import { TYPE_LABEL } from './InstallList'
import { ListingFiles } from './ListingFiles'
import { VersionDiff } from './VersionDiff'
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

/** A listing's glyph: Skill and 插件 read apart at a glance; official plugins have their own drawn tile. */
export function ListingIcon({
  type,
  size = 36,
  official,
}: {
  type: ListingType
  size?: number
  /** The listing's name when it is an official one. */
  official?: string
}) {
  if (type === 'plugin' && official && hasOfficialIcon(official))
    return <OfficialIcon name={official} size={size} />
  return (
    <span className="mkt-icon" data-type={type} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={type === 'plugin' ? 'plug' : 'sparkle'} size={Math.round(size * 0.5)} />
    </span>
  )
}

/** SKILL.md's YAML header is metadata already shown above; rendered as Markdown it reads as a stray heading. */
export const stripFrontMatter = (md: string) =>
  md.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')

/** `作者 · 团队`, or 官方 for platform listings. */
export const byline = (l: Pick<MarketListingDto, 'author' | 'teamName' | 'source'>) =>
  [l.author, l.teamName].filter(Boolean).join(' · ') || SOURCE_LABEL[l.source]

/** 已引入到：我的个人、支付核心群 */
export const installedText = (where: NonNullable<MarketListingDto['installedIn']>) =>
  t('已引入到：{targets}', {
    targets: where.map((x) => (x.scope === 'user' ? t('我的个人') : x.label)).join(t('、')),
  })

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
  const { data, error, reload } = useGet<MarketListingDetailDto>(
    `/market/${id}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`,
  )
  const [banning, setBanning] = useState(false)
  const [diffOf, setDiffOf] = useState<ListingVersionDto | null>(null)
  if (!data) return error ? <Alert variant="error" title={error} /> : <Spinner />
  const gh = data.ghSource
  const banned = data.status === 'banned'
  const unban = () => attempt(() => api.del(`/market/${data.id}/ban`)).then(reload)
  const readme = stripFrontMatter(data.readme)
  const action = actions?.(data)
  return (
    <div className="mkt-detail">
      <div className="mkt-detail__hero">
        <ListingIcon
          type={data.type}
          size={44}
          official={data.source === 'official' ? data.name : undefined}
        />
        <div className="mkt-detail__summary">
          <div className="mkt-detail__meta">
            <Tag tone="blue">{TYPE_LABEL[data.type]}</Tag>
            <Tag tone={data.source === 'official' ? 'green' : 'gray'}>{SOURCE_LABEL[data.source]}</Tag>
            {banned ? <Tag tone="red">{t('已封禁')}</Tag> : null}
            {data.agents.map((a) => (
              <Tag key={a}>{a}</Tag>
            ))}
          </div>
          <span className="mkt-detail__by">
            {data.listedRevision === null
              ? t('{by} · {n} 次引入', { by: byline(data), n: data.installs })
              : t('{by} · {n} 次引入 · r{rev}', {
                  by: byline(data),
                  n: data.installs,
                  rev: data.listedRevision,
                })}
          </span>
        </div>
      </div>
      {data.description ? <p className="mkt-detail__desc">{data.description}</p> : null}
      {data.installedIn?.length ? (
        <div className="mkt-detail__installed">
          <Icon name="check" size={14} />
          <span>{installedText(data.installedIn)}</span>
        </div>
      ) : null}
      {action || data.canReview ? (
        <div className="mkt-detail__actions">
          {action}
          <span className="spacer" />
          {data.canReview ? (
            banned ? (
              <Button size="small" onClick={() => void unban()}>
                {t('解封')}
              </Button>
            ) : (
              <Button size="small" variant="destructive" onClick={() => setBanning(true)}>
                {t('封禁')}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      {banned && data.banReason ? (
        <Alert
          variant="error"
          title={t('封禁原因：{reason}', { reason: data.banReason })}
          description={
            data.installedIn?.length
              ? t('已引入的地方下一轮起停止加载，可在对应设置的 Skill · 已引入 里移除')
              : undefined
          }
        />
      ) : null}
      {gh ? (
        <div className="mkt-detail__gh">
          <Icon name="github" size={14} />
          <Link external href={gh.url}>
            {[gh.url, gh.ref, gh.path].filter(Boolean).join(' · ')}
          </Link>
          <code className="gs-mono">@{gh.commit.slice(0, 7)}</code>
        </div>
      ) : null}
      <section className="mkt-detail__section" aria-label={t('说明')}>
        <div className="cfg__eyebrow">{t('说明')}</div>
        <div className="mkt-detail__readme">
          {readme.trim() ? <Markdown text={readme} /> : <span className="gs-note">{t('（没有说明）')}</span>}
        </div>
      </section>
      <section className="mkt-detail__section" aria-label={t('文件')}>
        <div className="cfg__eyebrow">
          {t('文件')} <span className="mkt-detail__n">{data.files.length}</span>
        </div>
        <ListingFiles listingId={data.id} versionId={versionId} files={data.files} />
      </section>
      <section className="mkt-detail__section" aria-label={t('版本历史')}>
        <div className="cfg__eyebrow">
          {t('版本历史')} <span className="mkt-detail__n">{data.versions.length}</span>
        </div>
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
            >
              {data.canReview || data.canEdit ? (
                <Button size="small" variant="plain" onClick={() => setDiffOf(v)}>
                  {t('查看变更')}
                </Button>
              ) : null}
            </GroupRow>
          ))}
        </GroupBox>
      </section>
      <Presence>
        {banning ? (
          <BanDialog
            listing={data}
            onClose={() => setBanning(false)}
            onDone={() => {
              setBanning(false)
              reload()
            }}
          />
        ) : diffOf ? (
          <Dialog
            open
            title={t('{name} r{n} 的变更', { name: data.title, n: diffOf.revision })}
            width={760}
            onClose={() => setDiffOf(null)}
          >
            <VersionDiff listingId={data.id} versionId={diffOf.id} />
          </Dialog>
        ) : null}
      </Presence>
    </div>
  )
}

/** 封禁: stops a listing everywhere from the next turn; the reason shows to its maintainers. */
function BanDialog({
  listing,
  onClose,
  onDone,
}: {
  listing: MarketListingDetailDto
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ban = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/market/${listing.id}/ban`, { reason: reason.trim() })
      toast({ type: 'success', message: t('已封禁「{name}」', { name: listing.title }) })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('封禁「{name}」', { name: listing.title })}
      width={480}
      closeOnScrim={false}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: t('封禁'),
          variant: 'destructive',
          disabled: busy || !reason.trim(),
          onClick: () => void ban(),
        },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      <div className="gs-note">{t('封禁后所有引入下一轮起停止加载，市场不再显示，也不能新引入。')}</div>
      <TextArea
        label={t('封禁原因')}
        aria-label={t('封禁原因')}
        placeholder={t('维护者会看到这个原因')}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Dialog>
  )
}
