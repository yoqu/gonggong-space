import type { ConnectorDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Alert, Button, Icon, SearchField, Spinner, Switch, toast } from '../../ui'
import { PluginTile, pluginIcon } from '../plugins/PluginTile'
import { ConnectorStatusLine, needsConnect } from './ConnectorStatus'
import { checkConnector, loadConnectors, needsCheck, switchConnector, useConnectorStore } from './store'
import './connectors.css'

/** The market on its 连接外部系统 scene. */
export const CONNECTOR_MARKET = '/market?scene=connect'

/** Market link preserving the originating group so the user can install directly for it. */
export const connectorMarketPath = (groupId?: string) =>
  groupId ? `${CONNECTOR_MARKET}&fromGroup=${encodeURIComponent(groupId)}` : CONNECTOR_MARKET

const matches = (c: ConnectorDto, q: string) =>
  [c.manifest.title, c.manifest.name, c.manifest.description].some((s) => s.toLowerCase().includes(q))

/**
 * The composer's 外部连接 menu: the group's external connection plugins with traffic-light status; ready ones
 * carry my own switch for this group, actionable ones a 连接 / 重新连接 button.
 */
export function ConnectorMenu({
  groupId,
  onPick,
  onClose,
}: {
  groupId: string
  onPick: (c: ConnectorDto) => void
  onClose: () => void
}) {
  const list = useConnectorStore((s) => s.lists[groupId])
  const error = useConnectorStore((s) => s.errors[groupId] ?? null)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  // Connecting elsewhere (a bot's 填写密钥 card) changes the status: refresh on every open, then check what is new.
  useEffect(() => {
    void loadConnectors(groupId).then(() => {
      for (const c of useConnectorStore.getState().lists[groupId] ?? [])
        if (needsCheck(c)) void checkConnector(groupId, c.id).catch(() => {})
    })
  }, [groupId])
  const retry = async () => {
    if (retrying) return
    setRetrying(true)
    try {
      await loadConnectors(groupId)
      for (const c of useConnectorStore.getState().lists[groupId] ?? [])
        if (needsCheck(c)) void checkConnector(groupId, c.id).catch(() => {})
    } finally {
      setRetrying(false)
    }
  }
  const toggle = async (c: ConnectorDto, on: boolean) => {
    if (togglingId === c.id) return
    setTogglingId(c.id)
    try {
      await switchConnector(groupId, c.id, on)
      toast({
        type: 'success',
        message: on
          ? t('已在本群启用「{name}」', { name: c.manifest.title })
          : t('已在本群停用「{name}」，Bot 处理你的消息时不再使用它', { name: c.manifest.title }),
      })
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setTogglingId((cur) => (cur === c.id ? null : cur))
    }
  }
  const enabled = list?.filter((c) => c.enabledInGroup)
  const q = query.trim().toLowerCase()
  const shown = enabled?.filter((c) => !q || matches(c, q))
  const market = () => {
    onClose()
    navigate(connectorMarketPath(groupId))
  }
  return (
    <div className="pn-mentionpicker mention-pop cn-menu" role="dialog" aria-label={t('外部连接')}>
      <div className="cn-menu__head">
        <span className="cn-menu__title">{t('本群外部连接插件')}</span>
        <span className="cn-menu__sub">{t('开启后 Bot 可替你查数据与办事')}</span>
      </div>
      {enabled?.length ? (
        <SearchField
          className="cn-menu__search"
          placeholder={t('搜索外部连接')}
          aria-label={t('搜索外部连接')}
          value={query}
          onChange={setQuery}
        />
      ) : null}
      {!enabled || !shown ? (
        error ? (
          <Alert
            variant="error"
            title={error}
            onRetry={() => void retry()}
            retrying={retrying}
            retryLabel={t('重试')}
          />
        ) : (
          <div className="cn-menu__loading">
            <Spinner />
          </div>
        )
      ) : !enabled.length ? (
        <div className="cn-menu__empty">
          <strong>{t('还没有可用的外部连接插件')}</strong>
          <span className="gs-note">
            {t('在插件市场添加飞书、数仓等外部连接后，Bot 就能替你查数据、办事情')}
          </span>
          <Button size="small" onClick={market}>
            {t('去插件市场添加')}
          </Button>
        </div>
      ) : shown.length ? (
        <ul className="cn-menu__list">
          {shown.map((c) => (
            <li key={c.id} className={cx('cn-row', !c.on && 'cn-row--off')}>
              <button
                type="button"
                className="cn-row__main"
                aria-label={c.manifest.title}
                onClick={() => onPick(c)}
              >
                <PluginTile m={c.manifest} size={28} src={pluginIcon(c)} />
                <span className="cn-row__text">
                  <span className="cn-row__name">{c.manifest.title}</span>
                  <ConnectorStatusLine c={c} />
                </span>
              </button>
              {needsConnect(c) ? (
                <Button size="small" onClick={() => onPick(c)}>
                  {c.status === 'expired' ? t('重新连接') : t('连接')}
                </Button>
              ) : (c.cli ? c.cli.state === 'ready' : c.connected) ? (
                <Switch
                  size="small"
                  checked={c.on}
                  disabled={togglingId === c.id}
                  loading={togglingId === c.id}
                  ariaLabel={t('在本群启用「{name}」', { name: c.manifest.title })}
                  onChange={(on) => void toggle(c, on)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mention-pop__empty">{t('没有匹配的外部连接')}</div>
      )}
      <button type="button" className="cn-menu__manage" onClick={market}>
        <Icon name="plus" size={14} />
        {t('添加更多外部连接插件')}
      </button>
    </div>
  )
}
