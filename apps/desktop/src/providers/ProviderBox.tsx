import type { AgentKind } from '@gonggong/protocol'
import { Button, GroupBox } from '@web/ui'
import { t } from '../i18n'
import { ipc, type Providers } from '../ipc'
import { fail } from '../lib/ui'

export const OFFICIAL = 'official'
export const OFFICIAL_NAME = t('官方登录')

/** 本机供应商 of one agent: the machine default (radio); adding and editing them is the Web's. */
export function ProviderBox({
  agent,
  data,
  onSwitch,
}: {
  agent: AgentKind
  data: Providers
  /** A confirmed switch of the machine default (`useProviderSwitch`). */
  onSwitch: (agent: AgentKind, choice: string) => void
}) {
  const current = data.machine[agent] ?? OFFICIAL
  const list = data.providers.filter((p) => p.agent === agent)

  const row = (value: string, name: string, sub: string) => (
    <div key={value} className="dk-row">
      <label className="ui-radio dk-row__main dk-provider">
        <input
          type="radio"
          name={`provider-${agent}`}
          value={value}
          checked={current === value}
          onChange={() => onSwitch(agent, value)}
        />
        <span className="ui-radio__dot" />
        <span className="dk-row__main">
          <span>{name}</span>
          <span className="dk-sub dk-ellipsis">{sub}</span>
        </span>
      </label>
    </div>
  )

  return (
    <GroupBox>
      <div className="dk-row">
        <span className="dk-row__main">
          <span className="dk-strong">{t('本机供应商')}</span>
          <span className="dk-sub">
            {t('选中的是本机默认，新会话使用它；进行中的会话开启新会话后才切换')}
          </span>
        </span>
        <Button onClick={() => ipc.openProvidersInWeb().catch(fail)}>{t('在 Web 中管理')}</Button>
      </div>
      {row(OFFICIAL, OFFICIAL_NAME, t('使用本机 CLI 自己的登录与配置'))}
      {list.map((p) =>
        row(p.id, p.name, [p.baseUrl, p.model, `Key ${p.apiKey}`].filter(Boolean).join(' · ')),
      )}
    </GroupBox>
  )
}
