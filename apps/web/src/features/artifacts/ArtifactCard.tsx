import type { ArtifactCard } from '@gonggong/protocol'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { Button, Icon, Skeleton, Spinner, Tag } from '../../ui'
import { openArtifact } from './store'
import './artifacts.css'

/**
 * The artifact card in the conversation (产物托管 plan §4): one per artifact, updated in place as versions arrive;
 * 打开 shows its canvas in the workbench.
 */
export function ArtifactCardView({ card }: { card: ArtifactCard }) {
  const me = useSession((s) => s.user?.id)
  const open = () => openArtifact(card.artifactId, card.title)
  const generating = card.status === 'generating'
  const hidden = card.visibility === 'private' && !!card.createdBy && card.createdBy !== me
  return (
    <div className="art-card" data-testid="artifact-card">
      <button type="button" className="art-card__shot" tabIndex={-1} onClick={open}>
        {hidden ? (
          <Icon name="lock" size={28} className="art-card__placeholder" />
        ) : card.thumbnailUrl ? (
          <>
            <img src={card.thumbnailUrl} alt={t('{title} 缩略图', { title: card.title })} loading="lazy" />
            {card.thumbnailStale ? (
              <span className="art-card__stale" data-testid="art-thumb-stale">
                {t('缩略图为旧版本')}
              </span>
            ) : null}
          </>
        ) : generating ? (
          <Skeleton variant="block" count={1} width="100%" height="100%" label={t('正在生成')} />
        ) : (
          <Icon name="grid" size={32} className="art-card__placeholder" />
        )}
      </button>
      <div className="art-card__body">
        <div className="art-card__head">
          <Icon name="grid" size={14} />
          <span className="art-card__title" title={card.title}>
            {card.title}
          </span>
          {card.versionN ? <span className="art-card__ver">{`v${card.versionN}`}</span> : null}
        </div>
        <div className="art-card__meta">
          {generating ? (
            <span className="art-card__state">
              <Spinner size={12} />
              {t('生成中')}
            </span>
          ) : card.status === 'stale-candidate' ? (
            <Tag tone="orange">{t('有候选版本')}</Tag>
          ) : (
            <span className="art-card__state">
              <span className="art-card__dot" />
              {t('就绪')}
            </span>
          )}
          {card.visibility === 'private' ? (
            <Tag icon="lock">{hidden ? t('仅创建人可见') : t('仅自己可见')}</Tag>
          ) : null}
          {card.issueCount ? (
            <Tag tone="orange" icon="warning">
              {t('{n} 项规范问题', { n: card.issueCount })}
            </Tag>
          ) : null}
          <Button size="small" className="art-card__open" onClick={open}>
            {t('打开')}
          </Button>
        </div>
      </div>
    </div>
  )
}
