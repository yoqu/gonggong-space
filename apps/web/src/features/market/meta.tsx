import {
  type InstalledTarget,
  isMarketHiddenCategory,
  type ListingSummary,
  type ListingType,
  type MarketListingDto,
  type MarketSource,
  type PluginCapability,
  type PluginReadiness,
  type PluginScene,
  shelfOf,
} from '@gonggong/protocol'
import { t } from '../../i18n'
import { Button, Icon, type IconName, paletteColor, Tag, type TagTone, toast } from '../../ui'
import { draftKey } from '../chat/MessageComposer'

export type MarketScene = PluginScene
export type MarketCapability = PluginCapability
export type MarketReadiness = PluginReadiness

/** Market listing enriched with client-side live health flags from GET /api/market/installed. */
export type MarketListingView = MarketListingDto & {
  needsConfig?: boolean
  needsTrust?: boolean
}

export interface SceneMeta {
  id: MarketScene
  label: string
  description: string
  icon: IconName
  color: string
}

export const SCENES: SceneMeta[] = [
  {
    id: 'connect',
    label: t('连接外部系统'),
    description: t('连上飞书、数仓和外部业务系统，让 Bot 替你查数据、建任务。'),
    icon: 'link',
    color: 'var(--system-orange)',
  },
  {
    id: 'create',
    label: t('专业创作'),
    description: t('自带模板与交互画布，直接产出原型、幻灯片和看板。'),
    icon: 'palette',
    color: 'var(--system-purple)',
  },
  {
    id: 'office',
    label: t('办公与协作'),
    description: t('周报、纪要、文档整理和日常审批提效工具。'),
    icon: 'message',
    color: 'var(--system-blue)',
  },
  {
    id: 'dev',
    label: t('研发与数据'),
    description: t('代码审查、接口文档、取数分析和排障辅助。'),
    icon: 'doc-code',
    color: 'var(--system-teal)',
  },
  {
    id: 'tools',
    label: t('效率工具'),
    description: t('即装即用的快捷指令与轻量助手。'),
    icon: 'bolt',
    color: 'var(--system-green)',
  },
]

export const SCENE_MAP: Record<MarketScene, SceneMeta> = Object.fromEntries(
  SCENES.map((s) => [s.id, s]),
) as Record<MarketScene, SceneMeta>

export const SOURCE_LABEL: Record<MarketSource, string> = {
  official: t('官方'),
  team: t('本团队'),
  public: t('公开社区'),
}

export const CAPABILITY_META: Record<MarketCapability, { label: string; icon: IconName; tone: TagTone }> = {
  do: { label: t('会做'), icon: 'sparkle', tone: 'blue' },
  connect: { label: t('能连'), icon: 'link', tone: 'orange' },
  create: { label: t('能创作'), icon: 'palette', tone: 'purple' },
}

export const READINESS_LABEL: Record<MarketReadiness, string> = {
  ready: t('开箱即用'),
  'needs-account': t('需连账号'),
  'needs-secret': t('需填凭据'),
  'needs-trust': t('需机主授权'),
}

/** Agent engines and provider presets belong in Machine settings, never in Plugin Market. */
export const isSystemPreset = (d: Pick<ListingSummary, 'category'>) => isMarketHiddenCategory(d.category)

/** Pure fallback derivation when older API payloads lack explicit scene/capabilities/readiness. */
export function sceneOfListing(
  l: Pick<MarketListingView, 'scene' | 'category' | 'name' | 'title' | 'description'>,
): MarketScene {
  if (l.scene && l.scene in SCENE_MAP) return l.scene
  const shelf = l.category ? shelfOf(l.category) : null
  if (shelf === 'connector') return 'connect'
  if (shelf === 'creation') return 'create'
  const text = `${l.name} ${l.title} ${l.description}`.toLowerCase()
  if (/sql|数仓|代码|review|diff|api|接口|git|bug|测试|研发|日志/.test(text)) return 'dev'
  if (/周报|会议|纪要|审批|文档|日程|合同|翻译|邮件|协作/.test(text)) return 'office'
  if (/飞书|钉钉|jira|github|连接|同步/.test(text)) return 'connect'
  return 'tools'
}

export function capabilitiesOfListing(
  l: Pick<MarketListingView, 'capabilities' | 'category' | 'type'>,
): MarketCapability[] {
  if (l.capabilities?.length) return l.capabilities
  const shelf = l.category ? shelfOf(l.category) : null
  if (shelf === 'connector') return ['connect']
  if (shelf === 'creation') return ['create']
  return ['do']
}

export function readinessOfListing(l: Pick<MarketListingView, 'readiness' | 'category'>): MarketReadiness {
  if (l.readiness && l.readiness in READINESS_LABEL) return l.readiness
  if (l.category === 'connector') return 'needs-account'
  return 'ready'
}

/** `作者 · 团队`, or 官方 for platform listings. */
export const byline = (l: Pick<MarketListingDto, 'author' | 'teamName' | 'source'>) =>
  [l.author, l.teamName].filter(Boolean).join(' · ') || SOURCE_LABEL[l.source]

/** 已添加到：我的插件、产品讨论群 */
export const installedText = (where: InstalledTarget[]) =>
  t('已添加到：{targets}', {
    targets: where.map((x) => (x.scope === 'user' ? t('我的插件') : x.label)).join(t('、')),
  })

/** Pick a Pane icon for a listing without a custom SVG tile. */
export function iconForListing(
  l?: Pick<ListingSummary, 'type' | 'category' | 'name'> & { scene?: MarketScene },
): IconName {
  if (!l) return 'sparkle'
  switch (l.category) {
    case 'connector':
      return 'link'
    case 'deck':
      return 'slides'
    case 'dashboard':
      return 'chart-bar'
    case 'poster':
      return 'image'
    case 'video':
      return 'video'
    case 'web':
      return 'palette'
    default: {
      if (l.scene && l.scene in SCENE_MAP) return SCENE_MAP[l.scene].icon
      return l.type === 'plugin' ? 'plug' : 'sparkle'
    }
  }
}

/** Crisp Pane icon tile: plugin's own SVG when declared, else solid palette tile with white line icon. */
export function ListingIcon({
  type,
  size = 38,
  listing,
}: {
  type: ListingType
  size?: number
  listing?: Pick<ListingSummary, 'id' | 'versionId' | 'icon' | 'name' | 'category'> & { scene?: MarketScene }
}) {
  const lg = size >= 48
  if (type === 'plugin' && listing?.icon)
    return (
      <img
        className={`mkt-icon mkt-icon--img${lg ? ' mkt-icon--lg' : ''}`}
        src={`/api/market/${listing.id}/files/raw?${new URLSearchParams({ path: listing.icon, versionId: listing.versionId })}`}
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
      />
    )
  const bg = paletteColor(listing?.name ?? listing?.id ?? type)
  return (
    <span
      className={`mkt-icon${lg ? ' mkt-icon--lg' : ''}`}
      data-type={type}
      style={{ width: size, height: size, background: bg }}
      aria-hidden="true"
    >
      <Icon name={iconForListing(listing ? { ...listing, type } : undefined)} size={Math.round(size * 0.5)} />
    </span>
  )
}

export function CapabilityChips({
  capabilities,
  readiness,
}: {
  capabilities: MarketCapability[]
  readiness?: MarketReadiness
}) {
  return (
    <div className="mkt-chips">
      {capabilities.map((cap) => {
        const m = CAPABILITY_META[cap]
        return (
          <Tag key={cap} tone={m.tone} icon={m.icon}>
            {m.label}
          </Tag>
        )
      })}
      {readiness ? <Tag tone="gray">{READINESS_LABEL[readiness]}</Tag> : null}
    </div>
  )
}

export function SourceByline({ l }: { l: Pick<MarketListingDto, 'source' | 'teamName'> }) {
  const icon: IconName = l.source === 'official' ? 'shield-check' : l.source === 'team' ? 'person-2' : 'globe'
  const label = l.source === 'team' && l.teamName ? l.teamName : SOURCE_LABEL[l.source]
  const cls =
    l.source === 'official'
      ? 'mkt-pcard__src mkt-pcard__src--official'
      : l.source === 'team'
        ? 'mkt-pcard__src mkt-pcard__src--team'
        : 'mkt-pcard__src'
  return (
    <span className={cls}>
      <Icon name={icon} size={12} />
      {label}
    </span>
  )
}

export function usageLabel(l: Pick<MarketListingView, 'teamGroupsCount' | 'installs'>) {
  if (l.teamGroupsCount && l.teamGroupsCount > 0) return t('团队 {n} 个群在用', { n: l.teamGroupsCount })
  if (l.installs > 0) return t('{n} 次添加', { n: l.installs })
  return t('刚上架')
}

export type CardActionKind = 'add' | 'request' | 'configure' | 'installed'

export function cardActionOf(l: MarketListingView, canInstallDirectly: boolean): CardActionKind {
  if (l.needsConfig || l.needsTrust) return 'configure'
  if (l.installedIn?.length) return 'installed'
  return canInstallDirectly ? 'add' : 'request'
}

/** 4-layer store plugin card matching the Pane prototype. */
export function PluginCard({
  listing: l,
  canInstallDirectly,
  onOpen,
  onAction,
}: {
  listing: MarketListingView
  canInstallDirectly: boolean
  onOpen: (l: MarketListingView) => void
  onAction: (l: MarketListingView, action: CardActionKind) => void
}) {
  const caps = capabilitiesOfListing(l)
  const ready = readinessOfListing(l)
  const action = cardActionOf(l, canInstallDirectly)
  const isNew = Date.now() - Date.parse(l.updatedAt) < 7 * 86_400_000 && !l.installedIn?.length
  const statusTag = l.needsTrust ? (
    <Tag tone="orange">{t('待授权')}</Tag>
  ) : l.needsConfig ? (
    <Tag tone="orange">{t('待配置')}</Tag>
  ) : l.installedIn?.length ? (
    <span title={installedText(l.installedIn)}>
      <Tag tone="green">{t('已添加')}</Tag>
    </span>
  ) : isNew ? (
    <Tag tone="blue">{t('新上架')}</Tag>
  ) : null

  const ctaLabel =
    action === 'configure'
      ? l.needsTrust
        ? t('去授权')
        : t('去配置')
      : action === 'installed'
        ? t('已添加')
        : action === 'request'
          ? t('申请添加')
          : t('添加')

  const ctaVariant = action === 'add' ? 'primary' : 'default'
  const ctaClass =
    action === 'configure'
      ? 'mkt-btn-warn'
      : action === 'installed'
        ? 'mkt-btn-done'
        : action === 'request'
          ? 'mkt-btn-soft'
          : undefined

  return (
    <li className="mkt-card-item">
      <article className="mkt-pcard">
        <div className="mkt-pcard__top">
          <ListingIcon type={l.type} size={38} listing={l} />
          <div className="mkt-pcard__who">
            <button
              type="button"
              className="mkt-pcard__name"
              aria-label={t('查看 {name}', { name: l.title })}
              onClick={() => onOpen(l)}
            >
              {l.title}
            </button>
            <SourceByline l={l} />
          </div>
          {statusTag ? <span className="mkt-pcard__status">{statusTag}</span> : null}
        </div>
        <p className="mkt-pcard__desc">{l.description || t('（没有描述）')}</p>
        <CapabilityChips capabilities={caps} readiness={ready} />
        <div className="mkt-pcard__foot">
          <span className="mkt-pcard__used">
            {l.teamGroupsCount || l.installs ? <Icon name="person-2" size={12} /> : null}
            {usageLabel(l)}
          </span>
          <Button size="small" variant={ctaVariant} className={ctaClass} onClick={() => onAction(l, action)}>
            {ctaLabel}
          </Button>
        </div>
      </article>
    </li>
  )
}

/** Save a prompt into a group's composer draft and navigate there; fall back to clipboard if no group. */
export function openPromptInGroup(
  prompt: string,
  groupId: string | undefined,
  navigate: (to: string) => void,
) {
  if (groupId) {
    try {
      sessionStorage.setItem(draftKey(groupId), prompt)
    } catch {
      // Storage unavailable: still navigate to the group
    }
    navigate(`/g/${groupId}`)
    return
  }
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(prompt)
  }
  toast({ type: 'info', message: t('已复制示例，进入群聊即可直接提问') })
}
