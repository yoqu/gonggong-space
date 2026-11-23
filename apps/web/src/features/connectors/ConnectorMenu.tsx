import type { ConnectorDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { t } from '../../i18n'
import { Button, Icon, SearchField, Spinner, Tag } from '../../ui'
import { PluginTile, pluginIcon } from '../plugins/PluginTile'
import { loadConnectors, useConnectorStore } from './store'
import './connectors.css'

/** The market on its 连接器 shelf. */
export const CONNECTOR_MARKET = '/market?shelf=connector'

const matches = (c: ConnectorDto, q: string) =>
  [c.manifest.title, c.manifest.name, c.manifest.description].some((s) => s.toLowerCase().includes(q))

/** The composer's 连接器 menu: the group's enabled connectors and whether I connected each. */
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
  // Connecting elsewhere (a bot's 填写密钥 card) changes the status: refresh on every open.
  useEffect(() => {
    void loadConnectors(groupId)
  }, [groupId])
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
          <strong>{t('本群还没有开启连接器')}</strong>
          <span className="gs-note">
            {t('在市场把数仓、飞书项目等连接器引入本群，Bot 就能替你查询和操作')}
          </span>
          <Button size="small" onClick={market}>
            {t('去市场看看')}
          </Button>
        </div>
      ) : shown.length ? (
        <ul className="cn-menu__list">
          {shown.map((c) => (
            <li key={c.id} className="cn-row">
              <button type="button" className="cn-row__main" onClick={() => onPick(c)}>
                <PluginTile m={c.manifest} size={24} src={pluginIcon(c)} />
                <span className="cn-row__name">{c.manifest.title}</span>
              </button>
              {c.manifest.connector?.login ? (
                <Button size="small" onClick={() => onPick(c)}>
                  {t('连接')}
                </Button>
              ) : c.connected ? (
                <Tag tone="green">{t('已连接')}</Tag>
              ) : c.missing.length ? (
                <Button size="small" onClick={() => onPick(c)}>
                  {t('连接')}
                </Button>
              ) : (
                <Tag tone="gray">{t('待管理员配置')}</Tag>
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
