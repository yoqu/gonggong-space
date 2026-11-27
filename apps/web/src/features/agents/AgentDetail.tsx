import { type AgentState, agentMeta, fieldsFor, type ProviderStoreView } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { Button, GroupBox, GroupRow, Icon, IconButton, Presence, Tag, toast } from '../../ui'
import { AgentSettingsBox } from '../machines/AgentSettingsPanel'
import { OfficialEditor } from '../machines/ProviderEditor'
import { SwitchNote, switchLines, useProviderSwitch } from '../machines/providers'
import { SaveStatus, useSaves } from '../machines/save'
import { botProviderText, choiceValue, loginDisplay, machineDefault, parseChoice } from './model'
import { ProviderModelPicker } from './ProviderModelPicker'
import type { AgentBotRef, AgentLocal, AgentsSource } from './source'

const fail = (e: unknown) => toast({ type: 'error', message: errorText(e) })

function Command({ command }: { command: string }) {
  return (
    <span className="ag-value">
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
  onOpenLogin,
  onAgents,
  refreshTick = 0,
  bots,
}: {
  source: AgentsSource
  agent: AgentState
  /** null while the machine's providers are read or when its client keeps none. */
  view: ProviderStoreView | null
  onView: (view: ProviderStoreView) => void
  onAddProvider: () => void
  /** Opens the shared login dialog hosted by AgentsPanel; absent falls back to DefaultBox's own dialog. */
  onOpenLogin?: () => void
  /** Detects the agents again (after a path is picked or reset). */
  onAgents: () => Promise<void>
  /** Incremented after login dialog closes/succeeds to re-read local login info. */
  refreshTick?: number
  bots: AgentBotRef[]
}) {
  const meta = agentMeta(a.kind)
  const has = (f: string) => source.features.includes(f)
  const mine = bots.filter((b) => b.agentKind === a.kind)
  const models = a.catalog?.models.map((m) => m.name) ?? []
  const [local, setLocal] = useState<AgentLocal | null>(null)
  const login = loginDisplay(a, local)
  // Again after each detection: the path, and so the login, may have changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a.path, a.available, a.loginState and refreshTick trigger fresh reads
  useEffect(() => {
    let on = true
    source.agentLocal?.(a.kind).then((l) => on && setLocal(l), fail)
    return () => {
      on = false
    }
  }, [source, a.kind, a.path, a.available, a.loginState, refreshTick])
  const { pickPath, resetPath } = source
  const [pathBusy, setPathBusy] = useState<'pick' | 'reset' | null>(null)
  const changePath = (op: 'pick' | 'reset', task: () => Promise<unknown>) => async () => {
    if (pathBusy) return
    setPathBusy(op)
    try {
      const changed = await task()
      if (changed !== false) await onAgents()
    } catch (e) {
      fail(e)
    } finally {
      setPathBusy(null)
    }
  }
  return (
    <div className="ag-detail">
      <GroupBox>
        {a.available ? (
          <>
            <GroupRow
              label={t('路径')}
              className="ag-long"
              wideValue
              value={
                <span className="ag-value ag-value--wrap">
                  {a.path ? <span className="mx-mono">{a.path}</span> : '--'}
                  {local?.customPath && resetPath ? (
                    <Button
                      size="small"
                      disabled={pathBusy !== null}
                      loading={pathBusy === 'reset'}
                      onClick={() => void changePath('reset', () => resetPath(a.kind))()}
                    >
                      {t('恢复自动检测')}
                    </Button>
                  ) : null}
                  {pickPath ? (
                    <Button
                      size="small"
                      disabled={pathBusy !== null}
                      loading={pathBusy === 'pick'}
                      onClick={() => void changePath('pick', () => pickPath(a.kind))()}
                    >
                      {t('更换路径…')}
                    </Button>
                  ) : null}
                </span>
              }
            />
            <GroupRow
              label={t('版本')}
              description={a.minVersion ? t('最低要求 {version}', { version: a.minVersion }) : undefined}
              wideValue
              value={a.version ?? '--'}
            />
            <GroupRow
              label={t('来源')}
              wideValue
              value={a.managed ? t('共工空间托管') : t('自行安装')}
              description={a.installCommand ? t('自行安装，按它自己的方式升级') : undefined}
            />
            {a.installCommand ? null : (
              <GroupRow label={t('最新版本')} wideValue value={a.latest ?? t('无法获取，请检查镜像源')} />
            )}
            {!a.managed && a.upgradeCommand ? (
              <GroupRow
                label={t('升级命令')}
                className="ag-long"
                description={t('升级时按原安装方式运行，也可以在这台电脑的终端自己运行')}
                wideValue
                value={<Command command={a.upgradeCommand} />}
              />
            ) : null}
            {login ? (
              <GroupRow
                label={t('登录#status')}
                wideValue
                value={
                  login.state === 'logged_out' ? (
                    <span className="ag-value">
                      <Tag tone="orange">{login.text}</Tag>
                      {onOpenLogin ? (
                        <Button size="small" variant="primary" onClick={onOpenLogin}>
                          {t('去登录')}
                        </Button>
                      ) : null}
                    </span>
                  ) : (
                    login.text
                  )
                }
              />
            ) : null}
            <GroupRow
              label={t('适配器')}
              wideValue
              value={
                meta.adapter !== 'bundled'
                  ? t('CLI 内置适配器')
                  : local?.adapterVersion
                    ? t('共工内置适配器 {version}', { version: local.adapterVersion })
                    : t('共工内置适配器')
              }
            />
            <GroupRow
              label={t('可用模型')}
              className="ag-long"
              wideValue
              value={models.length ? models.join(t('、')) : t('电脑上报后可见')}
            />
          </>
        ) : (
          <>
            <GroupRow
              label={t('安装方式')}
              wideValue
              value={
                <span className="ag-value ag-value--wrap">
                  {a.installCommand ? t('自行安装') : t('共工空间托管')}
                  {pickPath ? (
                    <Button
                      size="small"
                      disabled={pathBusy !== null}
                      loading={pathBusy === 'pick'}
                      onClick={() => void changePath('pick', () => pickPath(a.kind))()}
                    >
                      {t('手动指定路径…')}
                    </Button>
                  ) : null}
                </span>
              }
            />
            {a.minVersion ? <GroupRow label={t('最低版本')} wideValue value={a.minVersion} /> : null}
            {meta.note ? (
              <GroupRow label={t('运行要求')} wideValue value={t.text({ key: meta.note })} />
            ) : null}
            {a.installCommand ? (
              <GroupRow
                label={t('安装命令')}
                className="ag-long"
                description={t('共工空间无法自动安装它，请在这台电脑的终端运行')}
                wideValue
                value={<Command command={a.installCommand} />}
              />
            ) : (
              <GroupRow label={t('最新版本')} wideValue value={a.latest ?? t('无法获取，请检查镜像源')} />
            )}
            <GroupRow label={t('可用模型')} className="ag-long" wideValue value={t('安装并登录后可见')} />
          </>
        )}
      </GroupBox>
      {meta.login === 'own' ? (
        <p className="mx-sub ag-detail__note">{t.text({ key: meta.loginHint ?? '' })}</p>
      ) : !a.available ? (
        <p className="mx-sub ag-detail__note">{t('安装后可设置默认供应商与登录')}</p>
      ) : view && has('providers') ? (
        <DefaultBox
          source={source}
          agent={a}
          view={view}
          onView={onView}
          onAddProvider={onAddProvider}
          onOpenLogin={onOpenLogin}
          onAgents={onAgents}
          bots={bots}
        />
      ) : null}
      {a.available && view && has('agentSettings') && fieldsFor(a.kind, 'agent').length ? (
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
                value={view ? botProviderText(view, b) : undefined}
                onClick={source.openBot ? () => source.openBot?.(b.id) : undefined}
              />
            ))
          ) : (
            <GroupRow label={<span className="mx-sub">{t('这台电脑上还没有 Bot 使用它')}</span>} />
          )}
        </GroupBox>
      </section>
    </div>
  )
}

/** 默认「供应商/模型」 of the agent on this machine, switched at once; the official login's extras beside it. */
function DefaultBox({
  source,
  agent: a,
  view,
  onView,
  onAddProvider,
  onOpenLogin,
  onAgents,
  bots,
}: {
  source: AgentsSource
  agent: AgentState
  view: ProviderStoreView
  onView: (view: ProviderStoreView) => void
  onAddProvider: () => void
  onOpenLogin?: () => void
  onAgents: () => Promise<void>
  bots: AgentBotRef[]
}) {
  const agent = a.kind
  const models = source.features.includes('protocolProviders')
  const saves = useSaves()
  const [open, setOpen] = useState<'official' | 'login' | null>(null)
  const current = machineDefault(view, agent)
  const official = view.official[agent]

  const switcher = useProviderSwitch(async ({ choice, model }) => {
    await saves.save('default', async () => {
      onView(await source.setDefault(agent, choice, model ?? null))
      return undefined
    })
  })

  const pick = (value: string) => {
    const next = parseChoice(value)
    const change = { agent, choice: next.provider, model: next.model }
    if (source.confirmSwitch) {
      void (source.groupNames?.() ?? Promise.resolve(undefined)).then((groups) =>
        switcher.request(change, view, { groups, bots }),
      )
      return
    }
    saves.save('default', async () => {
      const lines = switchLines(view, change, { bots })
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
            {t('这台电脑上 Bot 默认使用它，新建会话生效；已有会话需要开新会话后切换')}
          </span>
        </span>
      </div>
      <GroupBox>
        <GroupRow
          label={t('供应商/模型')}
          description={models ? undefined : t('升级这台电脑的共工客户端后可同时选择模型')}
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
            <Button size="small" onClick={onAddProvider}>
              {t('新增供应商…')}
            </Button>
          </span>
        </GroupRow>
        <GroupRow
          label={t('官方登录')}
          description={[
            t('使用这台电脑上 CLI 自己的登录与配置'),
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
              <Button size="small" onClick={() => (onOpenLogin ? onOpenLogin() : setOpen('login'))}>
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
      {switcher.dialog}
      <Presence>
        {open === 'login'
          ? source.renderLogin?.({
              agent,
              agentState: a,
              onClose: () => setOpen(null),
              onAddProvider,
              onLoggedIn: () => void onAgents().catch(() => {}),
            })
          : null}
      </Presence>
    </section>
  )
}
