import {
  type AgentKind,
  type AgentState,
  agentMeta,
  fieldsFor,
  type ProviderStoreView,
} from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { copyWithToast } from '../../lib/clipboard'
import { Button, GroupBox, GroupRow, Icon, IconButton, Presence, toast } from '../../ui'
import { AgentSettingsBox } from '../machines/AgentSettingsPanel'
import { OfficialEditor } from '../machines/ProviderEditor'
import { effectiveProvider, SwitchNote, switchLines } from '../machines/providers'
import { SaveStatus, useSaves } from '../machines/save'
import { choiceLabel, choiceValue, machineDefault, parseChoice } from './model'
import { ProviderModelPicker } from './ProviderModelPicker'
import type { AgentBotRef, AgentsSource } from './source'

function Command({ command }: { command: string }) {
  return (
    <span className="mx-inline">
      <span className="mx-mono">{command}</span>
      <IconButton title={t('复制命令')} onClick={() => void copyWithToast(command, t('已复制命令'))}>
        <Icon name="copy" />
      </IconButton>
    </span>
  )
}

/**
 * An agent opened from the list: where it is and how it is kept up to date, what it runs with by default on this
 * machine (「供应商/模型」 and Agent 设置) and the bots using it.
 */
export function AgentDetail({
  source,
  agent: a,
  view,
  onView,
  onAddProvider,
  bots,
}: {
  source: AgentsSource
  agent: AgentState
  /** null while the machine's providers are read or when its client keeps none. */
  view: ProviderStoreView | null
  onView: (view: ProviderStoreView) => void
  onAddProvider: () => void
  bots: AgentBotRef[]
}) {
  const meta = agentMeta(a.kind)
  const has = (f: string) => source.features.includes(f)
  const mine = bots.filter((b) => b.agentKind === a.kind)
  const models = a.catalog?.models.map((m) => m.name) ?? []
  return (
    <div className="ag-detail">
      <GroupBox>
        <GroupRow
          label={t('路径')}
          wideValue
          value={a.path ? <span className="mx-mono">{a.path}</span> : '--'}
        />
        <GroupRow
          label={t('版本')}
          description={a.minVersion ? t('最低要求 {version}', { version: a.minVersion }) : undefined}
          wideValue
          value={a.version ?? '--'}
        />
        {a.available ? (
          <GroupRow
            label={t('来源')}
            wideValue
            value={a.managed ? t('共工空间托管') : t('自行安装')}
            description={a.installCommand ? t('自行安装，按它自己的方式升级') : undefined}
          />
        ) : null}
        {a.installCommand ? null : (
          <GroupRow label={t('最新版本')} wideValue value={a.latest ?? t('无法获取，请检查镜像源')} />
        )}
        {!a.managed && a.upgradeCommand ? (
          <GroupRow
            label={t('升级命令')}
            description={t('升级时按原安装方式运行，也可以在该机器的终端自己运行')}
            wideValue
            value={<Command command={a.upgradeCommand} />}
          />
        ) : null}
        {a.installCommand && !a.available ? (
          <GroupRow
            label={t('安装命令')}
            description={t('共工空间不能托管安装它，请在该机器的终端运行')}
            wideValue
            value={<Command command={a.installCommand} />}
          />
        ) : null}
        <GroupRow
          label={t('ACP 适配器')}
          wideValue
          value={meta.adapter === 'bundled' ? t('共工内置适配器') : t('CLI 自带 ACP')}
        />
        <GroupRow
          label={t('可用模型')}
          wideValue
          value={models.length ? models.join(t('、')) : t('机器上报后可见')}
        />
      </GroupBox>
      {meta.login === 'own' ? (
        <p className="mx-sub ag-detail__note">{t.text({ key: meta.loginHint ?? '' })}</p>
      ) : view && has('providers') ? (
        <DefaultBox source={source} agent={a} view={view} onView={onView} onAddProvider={onAddProvider} />
      ) : null}
      {view && has('agentSettings') && fieldsFor(a.kind, 'agent').length ? (
        <AgentSettingsBox source={source} bots={bots} agent={a.kind} view={view} onView={onView} />
      ) : null}
      <section className="mx-section" aria-label={t('使用它的 Bot')}>
        <span className="mx-section__head mx-strong">{t('使用它的 Bot')}</span>
        <GroupBox>
          {mine.length ? (
            mine.map((b) => (
              <GroupRow
                key={b.id}
                label={b.name}
                value={view ? botLine(view, a.kind, b.id) : undefined}
                onClick={source.openBot ? () => source.openBot?.(b.id) : undefined}
              />
            ))
          ) : (
            <GroupRow label={<span className="mx-sub">{t('这台机器上还没有 Bot 使用它')}</span>} />
          )}
        </GroupBox>
      </section>
    </div>
  )
}

const botLine = (view: ProviderStoreView, agent: AgentKind, botId: string) =>
  view.bots[botId]
    ? choiceLabel(view, effectiveProvider(view, agent, botId))
    : t('继承机器默认（{name}）', { name: choiceLabel(view, machineDefault(view, agent)) })

/** 默认「供应商/模型」 of the agent on this machine, switched at once; the official login's extras beside it. */
function DefaultBox({
  source,
  agent: a,
  view,
  onView,
  onAddProvider,
}: {
  source: AgentsSource
  agent: AgentState
  view: ProviderStoreView
  onView: (view: ProviderStoreView) => void
  onAddProvider: () => void
}) {
  const agent = a.kind
  const models = source.features.includes('protocolProviders')
  const saves = useSaves()
  const [open, setOpen] = useState<'official' | 'login' | null>(null)
  const current = machineDefault(view, agent)
  const official = view.official[agent]

  const pick = (value: string) => {
    const next = parseChoice(value)
    saves.save('default', async () => {
      const lines = switchLines(view, { agent, choice: next.provider, model: next.model })
      onView(await source.setDefault(agent, next.provider, next.model))
      return lines.length ? <SwitchNote lines={lines} /> : undefined
    })
  }

  return (
    <section className="mx-section" aria-label={t('默认「供应商/模型」')}>
      <div className="mx-section__head">
        <span className="mx-row__main">
          <span className="mx-strong">{t('默认「供应商/模型」')}</span>
          <span className="mx-sub">
            {t('这台机器上 Bot 默认使用它，新会话生效；进行中的会话开启新会话后才切换')}
          </span>
        </span>
      </div>
      <GroupBox>
        <GroupRow
          label={t('供应商/模型')}
          description={models ? undefined : t('升级该机器的客户端后可以同时选择模型')}
        >
          <span className="mx-inline">
            <SaveStatus state={saves.status('default')} />
            <ProviderModelPicker
              view={view}
              agent={agent}
              catalog={a.catalog}
              models={models}
              value={choiceValue(current.provider, models ? current.model : null)}
              onChange={pick}
            />
          </span>
        </GroupRow>
        <GroupRow
          label={t('官方登录')}
          description={[
            t('使用这台机器上 CLI 自己的登录与配置'),
            official?.proxy,
            Object.keys(official?.env ?? {}).length
              ? t('{n} 个环境变量', { n: Object.keys(official?.env ?? {}).length })
              : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          <span className="mx-inline">
            {source.renderLogin ? (
              <Button size="small" onClick={() => setOpen('login')}>
                {t('登录…')}
              </Button>
            ) : null}
            <Button size="small" onClick={() => setOpen('official')}>
              {t('设置…')}
            </Button>
          </span>
        </GroupRow>
      </GroupBox>
      <Presence>
        {open === 'official' ? (
          <OfficialEditor
            source={source}
            agent={agent}
            official={official}
            onClose={() => setOpen(null)}
            onSaved={(v) => {
              setOpen(null)
              onView(v)
              toast({ type: 'success', message: t('官方登录设置已保存') })
            }}
          />
        ) : null}
      </Presence>
      <Presence>
        {open === 'login'
          ? source.renderLogin?.({ agent, onClose: () => setOpen(null), onAddProvider })
          : null}
      </Presence>
    </section>
  )
}
