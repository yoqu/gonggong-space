import type { ConnectorCard, MessageDto } from '@gonggong/protocol'
import { memo, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Button, ChatNotice, Icon, Presence, Tag, toast } from '../../ui'
import { PluginTile, pluginIcon } from '../plugins/PluginTile'
import { ConnectorDialog } from './ConnectorDialog'
import { loadConnectors, useConnectorStore } from './store'
import './connectors.css'

const reasonText = (card: ConnectorCard) =>
  card.reason === 'expired'
    ? t('登录已过期')
    : card.reason === 'missing_scope'
      ? t('缺少权限：{domains}', { domains: card.domains.join(t('、')) })
      : t('未连接')

/**
 * A bot's 就地连接 card (connector_request): only the owner of the bot's machine connects from it, in
 * a private dialog; once connected the server resolves it and the run goes on.
 */
export const ConnectorCardView = memo(function ConnectorCardView({
  m,
  card,
}: {
  m: MessageDto
  card: ConnectorCard
}) {
  const mine = useSession((s) => s.user?.id === card.userId)
  const inGroup = useWorkspace((s) => s.groups.find((g) => g.id === m.groupId)?.kind !== 'dm')
  const c = useConnectorStore((s) => s.lists[m.groupId]?.find((x) => x.id === card.pluginId))
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const show = async () => {
    if (loading) return
    if (!c) {
      setLoading(true)
      try {
        await loadConnectors(m.groupId)
      } catch (e) {
        toast({ type: 'error', message: errorText(e) })
        return
      } finally {
        setLoading(false)
      }
      const { lists, errors } = useConnectorStore.getState()
      if (!lists[m.groupId]?.find((x) => x.id === card.pluginId)) {
        toast({
          type: 'error',
          message: errors[m.groupId] || t('无法打开连接器，请确认已在市场安装并启用'),
        })
        return
      }
    }
    setOpen(true)
  }
  return (
    <ChatNotice>
      <span className="tl-event" data-testid="connector-card">
        {c ? <PluginTile m={c.manifest} size={16} src={pluginIcon(c)} /> : <Icon name="plug" size={13} />}
        <span className="tl-event__text">
          {card.title} · {reasonText(card)}
        </span>
        {card.resolved ? (
          <Tag tone="green">{t('已连接，正在继续')}</Tag>
        ) : mine ? (
          <Button size="small" variant="primary" loading={loading} onClick={() => void show()}>
            {t('连接')}
          </Button>
        ) : (
          <Tag tone="gray">{t('仅电脑主人可连接')}</Tag>
        )}
      </span>
      <Presence>
        {open ? (
          <ConnectorDialog
            groupId={m.groupId}
            id={card.pluginId}
            inGroup={inGroup}
            domains={card.domains}
            machineId={card.machineId}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </Presence>
    </ChatNotice>
  )
})
