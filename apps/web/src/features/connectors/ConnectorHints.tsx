import type { BotDto, ConnectorDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { Button, Icon } from '../../ui'
import { linksTo } from './cli'
import { useConnectorStore } from './store'

const hostsOf = (c: ConnectorDto) => c.manifest.connector?.cli?.urlHosts ?? []
/** The draft is about the connector: its link, an example of it, or its name. */
const about = (c: ConnectorDto, draft: string) =>
  linksTo(draft, hostsOf(c)) ||
  draft.includes(c.manifest.title) ||
  !!c.manifest.connector?.examples.some((x) => draft.includes(x))

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One line above the composer for CLI connectors the draft needs (plan 连接器-体验升级方案 §5.5, §6): a link only a
 * connected account can read (链接胶囊), or an @-ed bot whose machine has no login of mine while another bot's has.
 * It never touches the draft unless asked to.
 */
export function ConnectorHints({
  groupId,
  draft,
  mentioned,
  bots,
  onDraft,
  onConnect,
}: {
  groupId: string
  draft: string
  mentioned: BotDto[]
  /** The group's bots. */
  bots: BotDto[]
  onDraft: (text: string) => void
  onConnect: (c: ConnectorDto) => void
}) {
  const list = useConnectorStore((s) => s.lists[groupId])
  if (!draft.trim() || !list) return null
  const cli = list.flatMap((c) => (c.enabledInGroup && c.on && c.cli ? [{ c, view: c.cli }] : []))
  // Only a machine's owner can connect: the others get no hint they cannot act on.
  const link = cli.find(
    ({ c, view }) => view.state !== 'ready' && view.target && linksTo(draft, hostsOf(c)),
  )?.c
  if (link)
    return (
      <p className="cn-hint" role="status">
        <Icon name="plug" size={12} />
        <span>{t('连接{name}后 Bot 才能读这篇文档', { name: link.manifest.title })}</span>
        <Button size="small" onClick={() => onConnect(link)}>
          {t('连接')}
        </Button>
      </p>
    )
  for (const { c, view } of cli) {
    const ready = view.readyBotIds
    const blocked = mentioned.find((b) => !ready.includes(b.id))
    const alt = bots.find((b) => ready.includes(b.id))
    if (!blocked || !alt || mentioned.some((b) => ready.includes(b.id)) || !about(c, draft)) continue
    const swap = () =>
      onDraft(draft.replace(new RegExp(`(^|\\s)@${escapeRe(blocked.name)}(?=\\s|$)`), `$1@${alt.name}`))
    return (
      <p className="cn-hint" role="status">
        <Icon name="info" size={12} />
        <span>{t('{bot} 所在电脑还没连接{name}', { bot: blocked.name, name: c.manifest.title })}</span>
        <Button size="small" variant="plain" onClick={swap}>
          {t('切换到 @{bot}', { bot: alt.name })}
        </Button>
        {view.target ? (
          <Button size="small" variant="plain" onClick={() => onConnect(c)}>
            {t('立即连接')}
          </Button>
        ) : null}
      </p>
    )
  }
  return null
}
