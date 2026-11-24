import type { ConnectorDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Button, Icon, SearchField, Spinner, Switch, toast } from '../../ui'
import { PluginTile, pluginIcon } from '../plugins/PluginTile'
import { ConnectorStatusLine, needsConnect } from './ConnectorStatus'
import { checkConnector, loadConnectors, needsCheck, switchConnector, useConnectorStore } from './store'
import './connectors.css'

/** The market on its 连接器 shelf. */
export const CONNECTOR_MARKET = '/market?shelf=connector'

const matches = (c: ConnectorDto, q: string) =>
  [c.manifest.title, c.manifest.name, c.manifest.description].some((s) => s.toLowerCase().includes(q))

/**
 * The composer's 连接器 menu: the group's connectors with my connection's status; connected ones carry my own switch
 * for this group, the others a 连接 / 重新连接 button.
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
  // Connecting elsewhere (a bot's 填写密钥 card) changes the status: refresh on every open, then check what is new.
  useEffect(() => {
    void loadConnectors(groupId).then(() => {
      for (const c of useConnectorStore.getState().lists[groupId] ?? [])
        if (needsCheck(c)) void checkConnector(groupId, c.id).catch(() => {})
    })
  }, [groupId])
  const toggle = async (c: ConnectorDto, on: boolean) => {
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
    }
  }
  const enabled = list?.filter((c) => c.enabledInGroup)
  const q = query.trim().toLowerCase()
  const shown = enabled?.filter((c) => !q || matches(c, q))
  const market = () => {
    onClose()
    navigate(CONNECTOR_MARKET)
  }
  return (
    <div className="pn-mentionpicker mention-pop cn-menu" role="dialog" aria-label={t('连接器')}>
      {enabled?.length ? (
        <SearchField
          className="cn-menu__search"
          placeholder={t('搜索连接器')}
          aria-label={t('搜索连接器')}
          value={query}
          onChange={setQuery}
        />
      ) : null}
      {!enabled || !shown ? (
        error ? (
          <div className="mention-pop__empty">{error}</div>
        ) : (
          <div className="cn-menu__loading">
            <Spinner />
          </div>
        )
      ) : !enabled.length ? (
        <div className="cn-menu__empty">
          <strong>{t('还没有可用的连接器')}</strong>
          <span className="gs-note">
            {t('在市场安装数仓、飞书等连接器后，所有群都能直接使用，Bot 就能替你查询和操作')}
          </span>
          <Button size="small" onClick={market}>
            {t('去市场看看')}
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
              ) : !c.cli && c.status === 'unconnected' ? null : (
                <Switch
                  size="small"
                  checked={c.on}
                  ariaLabel={t('在本群启用「{name}」', { name: c.manifest.title })}
                  onChange={(on) => void toggle(c, on)}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mention-pop__empty">{t('没有匹配的连接器')}</div>
      )}
      <button type="button" className="cn-menu__manage" onClick={market}>
        <Icon name="gear" size={14} />
        {t('管理连接器')}
      </button>
    </div>
  )
}
