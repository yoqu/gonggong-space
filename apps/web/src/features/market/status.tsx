import type { InstallDto, InstalledTarget, ListingSummary } from '@gonggong/protocol'
import { t } from '../../i18n'
import { Tag } from '../../ui'

// Shared with the desktop Skill page, so nothing here may reach the web API or router.

export const TYPE_LABEL: Record<ListingSummary['type'], string> = { skill: 'Skill', plugin: t('插件#type') }

export function StatusTag({ status }: { status: ListingSummary['status'] }) {
  if (status === 'unlisted') return <Tag tone="orange">{t('已下架')}</Tag>
  if (status === 'banned') return <Tag tone="red">{t('已封禁')}</Tag>
  return null
}

/** A pinned install whose listing has a newer version (a maintainer's self-test may run ahead of it). */
export const newerFor = (i: InstallDto) =>
  i.pinVersionId && i.listing.status !== 'banned' && i.listing.revision > i.resolvedRevision
    ? i.listing.revision
    : null

/** 锁定 r2 / 跟随最新 · r3, then 有新版本 and the listing's status. */
export function VersionTags({ install: i }: { install: InstallDto }) {
  const newer = newerFor(i)
  return (
    <>
      <Tag tone="gray">
        {i.pinVersionId
          ? t('锁定 r{n}', { n: i.resolvedRevision })
          : t('跟随最新 · r{n}', { n: i.resolvedRevision })}
      </Tag>
      {newer ? <Tag tone="green">{t('有新版本 r{n}', { n: newer })}</Tag> : null}
      <StatusTag status={i.listing.status} />
    </>
  )
}

/** What a banned or unlisted listing means for this install. */
export function statusNote(i: InstallDto) {
  if (i.listing.status === 'banned')
    return i.banReason
      ? t('封禁原因：{reason}。下一轮起停止加载，建议移除', { reason: i.banReason })
      : t('已封禁，下一轮起停止加载，建议移除')
  if (i.listing.status === 'unlisted')
    return t('已下架：继续使用 r{n}，不会再有新版本', { n: i.resolvedRevision })
  return null
}

/** 我的 Skill、支付核心群 */
export const targetLabels = (where: InstalledTarget[]) =>
  where.map((x) => (x.scope === 'user' ? t('我的 Skill') : x.label)).join(t('、'))
