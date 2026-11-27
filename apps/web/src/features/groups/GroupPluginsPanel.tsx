import {
  type ConnectorDto,
  createsArtifacts,
  type GroupDto,
  type GroupPluginDto,
  type InheritedSkillDto,
  type InstallDto,
  type SecretNeedDto,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  type ButtonProps,
  Disclosure,
  EmptyState,
  GroupBox,
  GroupRow,
  Icon,
  NoPluginsArt,
  Presence,
  Spinner,
  Switch,
  Tag,
} from '../../ui'
import { InheritedMcpList, McpLayerList, McpSaved, useMcpLayer } from '../config/ConfigPage'
import { GroupConfigView } from '../config/GroupConfigView'
import { InheritedSkillList, SkillLayerList } from '../config/SkillLayer'
import { ConnectorDialog } from '../connectors/ConnectorDialog'
import { connectorStatus, needsConnect } from '../connectors/ConnectorStatus'
import { loadConnectors, useConnectors } from '../connectors/store'
import { InstalledSection } from '../market/InstallList'
import { GroupPluginsTab } from '../plugins/PluginLayer'
import { PluginTile, pluginIcon } from '../plugins/PluginTile'
import { loadPlugins, togglePlugin, usePluginStore } from '../plugins/store'
import { actionable, NeedsDialog } from '../secrets/SecretNeeds'

function RouterNavButton({ to, onBefore, ...props }: { to: string; onBefore?: () => void } & ButtonProps) {
  const navigate = useNavigate()
  return (
    <Button
      {...props}
      onClick={() => {
        onBefore?.()
        navigate(to)
      }}
    />
  )
}

/** Navigates inside React Router when mounted under a Router, or falls back safely in isolated renders. */
export function SafeNavButton({
  to,
  onBefore,
  ...props
}: { to: string; onBefore?: () => void } & ButtonProps) {
  const inRouter = useInRouterContext()
  if (inRouter) return <RouterNavButton to={to} onBefore={onBefore} {...props} />
  return (
    <Button
      {...props}
      onClick={() => {
        onBefore?.()
        window.location.assign(to)
      }}
    />
  )
}

const sourceLabel = (p: GroupPluginDto) => {
  if (p.builtin) return t('官方 · 本群')
  if (p.layer === 'team') return t('团队统一继承')
  if (p.layer === 'platform') return t('平台统一')
  return t('本群')
}

const isSystemCategory = (cat: GroupPluginDto['manifest']['category']) =>
  cat === 'agent' || cat === 'provider'

function pluginHealth(
  p: GroupPluginDto,
  c?: ConnectorDto,
): { label: string; tone: 'green' | 'orange' | 'gray' } {
  if (!p.enabledInGroup) return { label: t('已停用'), tone: 'gray' }
  if (c) {
    const s = connectorStatus(c)
    if (s.tone === 'ok') return { label: t('已就绪'), tone: 'green' }
    if (c.status === 'expired') return { label: t('凭据已失效'), tone: 'orange' }
    if (needsConnect(c)) return { label: c.cli ? t('待连接账号') : t('待填你的凭据'), tone: 'orange' }
    if (!c.connected && !c.cli) return { label: t('待管理员配置'), tone: 'orange' }
    if (c.cli && c.cli.state !== 'ready') return { label: s.text, tone: 'orange' }
  }
  const blockers = p.bots.map((b) => b.blocker).filter(Boolean)
  if (blockers.includes('secret')) return { label: t('待填凭据'), tone: 'orange' }
  if (blockers.includes('trust')) return { label: t('待机主授权'), tone: 'orange' }
  if (blockers.includes('daemon')) return { label: t('客户端需升级'), tone: 'orange' }
  if (p.bots.length > 0 && p.bots.every((b) => b.blocker === 'agent'))
    return { label: t('当前 Bot 不支持'), tone: 'gray' }
  return { label: t('已就绪'), tone: 'green' }
}

/** Custom MCP server management inside the collapsed developer section; wires dirty/saving state to the dialog. */
function GroupMcpSection({
  group,
  onDirtyChange,
  onSavingChange,
}: {
  group: GroupDto
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
}) {
  const layer = useMcpLayer(`/groups/${group.id}/mcp`)
  useEffect(() => {
    onSavingChange?.(layer.busy)
  }, [layer.busy, onSavingChange])
  useEffect(() => () => onSavingChange?.(false), [onSavingChange])
  return (
    <div className="gs-adv__block">
      <div className="gs-adv__title">{t('自定义外部服务（MCP）')}</div>
      <div className="gs-note">{t('只对本群生效；与团队层、平台层同名时以群层为准。')}</div>
      <McpLayerList layer={layer} tag={t('群层')} onDirtyChange={onDirtyChange} />
      <McpSaved force={layer.savedForce} />
      <InheritedMcpList groupId={group.id} />
    </div>
  )
}

/**
 * 群设置 · 插件与能力 (3-in-1 consolidated view): summary strip, plain-language grouped list of
 * external connectors and specialized capabilities, and a default-collapsed developer section preserving
 * custom MCP, local Skill, and local plugin upload losslessly.
 */
export function GroupPluginsPanel({
  group,
  readOnly,
  initialAdvanced = false,
  onDirtyChange,
  onSavingChange,
  onOpenCredentials,
  onOpenBots,
  onClose,
}: {
  group: GroupDto
  readOnly: boolean
  initialAdvanced?: boolean
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
  onOpenCredentials: () => void
  onOpenBots: () => void
  onClose: () => void
}) {
  const dm = group.kind === 'dm'
  const pluginsOn = useSession((s) => !!s.tenancy?.pluginsEnabled)
  const bots = useWorkspace((s) => s.bots).filter((b) => group.botIds.includes(b.id))
  const pluginList = usePluginStore((s) => s.lists[group.id])
  const pluginError = usePluginStore((s) => s.errors[group.id] ?? null)
  useEffect(() => {
    if (pluginsOn && pluginList === undefined && !pluginError) loadPlugins(group.id)
  }, [pluginsOn, group.id, pluginList, pluginError])

  const connectors = useConnectors(group.id, pluginsOn && !dm)
  const installs = useGet<InstallDto[]>(dm ? null : `/groups/${group.id}/installs`)
  const inheritedSkills = useGet<InheritedSkillDto[]>(dm ? null : `/groups/${group.id}/inherited-skills`)
  const secretNeeds = useGet<SecretNeedDto[]>(dm ? null : `/groups/${group.id}/secret-needs`)

  const [toggling, setToggling] = useState<string | null>(null)
  const [openConnectorId, setOpenConnectorId] = useState<string | null>(null)
  const [openNeeds, setOpenNeeds] = useState(false)

  const connectorById = new Map((connectors ?? []).map((c) => [c.id, c]))
  const visiblePlugins = (pluginsOn ? (pluginList ?? []) : []).filter(
    (p) => !isSystemCategory(p.manifest.category),
  )
  const pluginNames = new Set(visiblePlugins.map((p) => p.manifest.name))

  const connectorPlugins = visiblePlugins.filter((p) => p.manifest.category === 'connector')
  const capabilityPlugins = visiblePlugins.filter((p) => p.manifest.category !== 'connector')

  const extraInstalls = (installs.data ?? []).filter((i) => !pluginNames.has(i.listing.name))
  const installNames = new Set(extraInstalls.map((i) => i.listing.name))
  const extraInherited = (inheritedSkills.data ?? []).filter(
    (s) => !pluginNames.has(s.name) && !installNames.has(s.name),
  )

  const enabledCount =
    connectorPlugins.filter((p) => p.enabledInGroup).length +
    capabilityPlugins.filter((p) => p.enabledInGroup).length +
    extraInstalls.filter((i) => i.enabled).length +
    extraInherited.filter((s) => s.enabledInGroup).length

  const pendingConnectors = connectorPlugins.filter((p) => {
    if (!p.enabledInGroup) return false
    const c = connectorById.get(p.id)
    return !!c && (needsConnect(c) || (!c.cli && !c.connected) || (!!c.cli && c.cli.state !== 'ready'))
  }).length
  const pendingCapabilities = capabilityPlugins.filter(
    (p) =>
      p.enabledInGroup &&
      p.bots.some((b) => b.blocker === 'secret' || b.blocker === 'trust' || b.blocker === 'daemon'),
  ).length
  const actionableNeeds = (secretNeeds.data ?? []).filter(actionable)
  const pendingCount = Math.max(pendingConnectors + pendingCapabilities, actionableNeeds.length ? 1 : 0)

  const flipPlugin = (p: GroupPluginDto, on: boolean) => {
    setToggling(`p:${p.id}`)
    void attempt(() => togglePlugin(group.id, p.id, on))
      .then((ok) => {
        if (ok && p.manifest.category === 'connector') void loadConnectors(group.id)
      })
      .finally(() => setToggling((cur) => (cur === `p:${p.id}` ? null : cur)))
  }

  const flipInstall = (i: InstallDto, on: boolean) => {
    const key = `i:${i.listing.id}`
    setToggling(key)
    void attempt(() =>
      api.put(`/groups/${group.id}/installs/${i.listing.id}`, {
        enabled: on,
        pinVersionId: i.pinVersionId,
      }),
    )
      .then((ok) => ok && installs.reload())
      .finally(() => setToggling((cur) => (cur === key ? null : cur)))
  }

  const flipInherited = (s: InheritedSkillDto, on: boolean) => {
    const key = `s:${s.name}`
    setToggling(key)
    void attempt(() =>
      api.put(`/groups/${group.id}/inherited-skills/${encodeURIComponent(s.name)}`, { enabled: on }),
    )
      .then((ok) => ok && inheritedSkills.reload())
      .finally(() => setToggling((cur) => (cur === key ? null : cur)))
  }

  const inRouter = useInRouterContext()
  const firstBot = bots[0]
  const marketUrl = `/market?fromGroup=${encodeURIComponent(group.id)}`
  const loadingPrimary = pluginsOn && pluginList === undefined && !pluginError
  const hasAny =
    connectorPlugins.length > 0 ||
    capabilityPlugins.length > 0 ||
    extraInstalls.length > 0 ||
    extraInherited.length > 0

  return (
    <div className="gs-cap">
      {readOnly ? (
        <div className="gs-ro-tip" role="note">
          {t('你是普通成员：可以查看本群插件和填写自己的个人凭据；启用或移除插件可去市场提交申请。')}
        </div>
      ) : null}

      <div className="gs-cap-summary">
        <div className="gs-cap-summary__main">
          <div className="gs-cap-summary__title">
            {pendingCount > 0
              ? t('本群已启用 {n} 个插件 · {pending} 个待配置', { n: enabledCount, pending: pendingCount })
              : t('本群已启用 {n} 个插件', { n: enabledCount })}
          </div>
          <div className="gs-cap-summary__sub">
            <span>{t('开启后群里所有在线 Bot 下一轮即可使用')}</span>
            {firstBot ? (
              <>
                {' · '}
                <SafeNavButton
                  variant="plain"
                  size="small"
                  className="gs-inline-link"
                  to={`/bot/${firstBot.id}?groupId=${encodeURIComponent(group.id)}`}
                  onBefore={onClose}
                >
                  {t('查看各 Bot 可用状态')}
                </SafeNavButton>
              </>
            ) : (
              <>
                {' · '}
                <Button variant="plain" size="small" className="gs-inline-link" onClick={onOpenBots}>
                  {t('查看群内 Bot')}
                </Button>
              </>
            )}
          </div>
        </div>
        <SafeNavButton
          variant={readOnly ? 'default' : 'primary'}
          size="small"
          icon="plus"
          to={marketUrl}
          onBefore={onClose}
        >
          {readOnly ? t('去市场申请') : t('从市场添加')}
        </SafeNavButton>
      </div>

      {pluginsOn && pluginError ? (
        <Alert
          variant="error"
          title={t('插件加载失败')}
          description={pluginError}
          onRetry={() => loadPlugins(group.id)}
        />
      ) : null}

      {loadingPrimary ? (
        <Spinner />
      ) : !hasAny && !pluginError ? (
        <EmptyState
          compact
          illustration={<NoPluginsArt />}
          title={t('还没有可用插件')}
          description={t('去插件市场挑选外部连接、专业创作或快捷指令插件。')}
          action={
            <SafeNavButton size="small" to={marketUrl} onBefore={onClose}>
              {readOnly ? t('去市场申请') : t('从市场添加')}
            </SafeNavButton>
          }
        />
      ) : (
        <>
          {connectorPlugins.length > 0 ? (
            <section className="gs-cap-sec" aria-label={t('连接外部系统')}>
              <h3 className="gs-section-title">{t('连接外部系统')}</h3>
              <GroupBox>
                {connectorPlugins.map((p) => {
                  const c = connectorById.get(p.id)
                  const health = pluginHealth(p, c)
                  const statusSub = c
                    ? connectorStatus(c).text
                    : p.manifest.description || t('连接外部系统，让 Bot 替你查询和操作')
                  const needAction = p.enabledInGroup && c && needsConnect(c)
                  return (
                    <GroupRow
                      key={p.id}
                      className="cfg__item"
                      label={
                        <div className="gs-cap-row">
                          <PluginTile m={p.manifest} size={32} src={pluginIcon(p)} />
                          <div className="gs-cap-row__text">
                            <span className="gs-cap-row__title">
                              <strong>{p.manifest.title}</strong>
                              <Tag tone="gray">{sourceLabel(p)}</Tag>
                              <Tag tone={health.tone}>{health.label}</Tag>
                            </span>
                            <span className="gs-desc">{statusSub}</span>
                          </div>
                        </div>
                      }
                    >
                      <span className="cfg__controls">
                        {needAction ? (
                          <Button size="small" onClick={() => setOpenConnectorId(c.id)}>
                            {t('去填写')}
                          </Button>
                        ) : p.enabledInGroup && c ? (
                          <Button size="small" onClick={onOpenCredentials}>
                            {t('账号状态')}
                          </Button>
                        ) : null}
                        {readOnly ? null : (
                          <Switch
                            disabled={toggling === `p:${p.id}`}
                            ariaLabel={t('在本群启用 {name}', { name: p.manifest.title })}
                            checked={p.enabledInGroup}
                            onChange={(on) => flipPlugin(p, on)}
                          />
                        )}
                      </span>
                    </GroupRow>
                  )
                })}
              </GroupBox>
            </section>
          ) : null}

          {capabilityPlugins.length > 0 || extraInstalls.length > 0 || extraInherited.length > 0 ? (
            <section className="gs-cap-sec" aria-label={t('专业创作与专项能力')}>
              <h3 className="gs-section-title">{t('专业创作与专项能力')}</h3>
              <GroupBox>
                {capabilityPlugins.map((p) => {
                  const health = pluginHealth(p)
                  const needsSecret = p.enabledInGroup && p.bots.some((b) => b.blocker === 'secret')
                  const desc =
                    p.manifest.description ||
                    (createsArtifacts(p.manifest)
                      ? t('出现在输入框「创作」与 / 菜单')
                      : t('启用后在群聊里即可直接让 Bot 使用'))
                  return (
                    <GroupRow
                      key={p.id}
                      className="cfg__item"
                      label={
                        <div className="gs-cap-row">
                          <PluginTile m={p.manifest} size={32} src={pluginIcon(p)} />
                          <div className="gs-cap-row__text">
                            <span className="gs-cap-row__title">
                              <strong>{p.manifest.title}</strong>
                              <Tag tone="gray">{sourceLabel(p)}</Tag>
                              <Tag tone={health.tone}>{health.label}</Tag>
                            </span>
                            <span className="gs-desc">{desc}</span>
                          </div>
                        </div>
                      }
                    >
                      <span className="cfg__controls">
                        {needsSecret ? (
                          <Button
                            size="small"
                            onClick={() =>
                              secretNeeds.data?.length ? setOpenNeeds(true) : onOpenCredentials()
                            }
                          >
                            {t('去填写')}
                          </Button>
                        ) : null}
                        {readOnly ? null : (
                          <Switch
                            disabled={toggling === `p:${p.id}`}
                            ariaLabel={t('在本群启用 {name}', { name: p.manifest.title })}
                            checked={p.enabledInGroup}
                            onChange={(on) => flipPlugin(p, on)}
                          />
                        )}
                      </span>
                    </GroupRow>
                  )
                })}
                {extraInstalls.map((i) => (
                  <GroupRow
                    key={`inst:${i.listing.id}`}
                    className="cfg__item"
                    label={
                      <div className="gs-cap-row">
                        <span className="gs-cap-tile" aria-hidden="true">
                          <Icon name="sparkle" size={15} />
                        </span>
                        <div className="gs-cap-row__text">
                          <span className="gs-cap-row__title">
                            <strong>{i.listing.title}</strong>
                            <Tag tone="gray">{t('本群')}</Tag>
                            <Tag tone={i.enabled ? 'green' : 'gray'}>
                              {i.enabled ? t('已就绪') : t('已停用')}
                            </Tag>
                          </span>
                          <span className="gs-desc">
                            {i.listing.description || t('通过 / 快捷指令或在对话中触发')}
                          </span>
                        </div>
                      </div>
                    }
                  >
                    {readOnly ? null : (
                      <span className="cfg__controls">
                        <Switch
                          disabled={toggling === `i:${i.listing.id}`}
                          ariaLabel={t('在本群启用 {name}', { name: i.listing.title })}
                          checked={i.enabled}
                          onChange={(on) => flipInstall(i, on)}
                        />
                      </span>
                    )}
                  </GroupRow>
                ))}
                {extraInherited.map((s) => (
                  <GroupRow
                    key={`inh:${s.name}`}
                    className="cfg__item"
                    label={
                      <div className="gs-cap-row">
                        <span className="gs-cap-tile" aria-hidden="true">
                          <Icon name="star" size={15} />
                        </span>
                        <div className="gs-cap-row__text">
                          <span className="gs-cap-row__title">
                            <strong>{s.name}</strong>
                            <Tag tone="gray">{s.scope === 'team' ? t('团队统一继承') : t('平台统一')}</Tag>
                            <Tag tone={s.enabledInGroup ? 'green' : 'gray'}>
                              {s.enabledInGroup ? t('已就绪') : t('已停用')}
                            </Tag>
                          </span>
                          <span className="gs-desc">
                            {s.description || t('团队管理员统一开启，本群可单独关闭')}
                          </span>
                        </div>
                      </div>
                    }
                  >
                    {readOnly ? null : (
                      <span className="cfg__controls">
                        <Switch
                          disabled={toggling === `s:${s.name}`}
                          ariaLabel={t('在本群启用 {name}', { name: s.name })}
                          checked={s.enabledInGroup}
                          onChange={(on) => flipInherited(s, on)}
                        />
                      </span>
                    )}
                  </GroupRow>
                ))}
              </GroupBox>
            </section>
          ) : null}
        </>
      )}

      {!dm || (!readOnly && pluginsOn) ? (
        <Disclosure
          variant="group"
          defaultOpen={initialAdvanced}
          title={readOnly ? t('开发者高级配置（只读）') : t('开发者高级配置（自定义 MCP 服务与本地上传）')}
        >
          <div className={cx('gs-adv')}>
            {dm ? null : readOnly ? (
              <>
                <div className="gs-adv__block">
                  <div className="gs-adv__title">{t('自定义外部服务（MCP）')}</div>
                  <GroupConfigView groupId={group.id} kind="mcp" />
                </div>
                <div className="gs-adv__block">
                  <div className="gs-adv__title">{t('本地指令包（Skill）')}</div>
                  <GroupConfigView groupId={group.id} kind="skill" />
                  <InstalledSection base={`/groups/${group.id}`} readOnly />
                </div>
              </>
            ) : (
              <>
                <GroupMcpSection
                  group={group}
                  onDirtyChange={onDirtyChange}
                  onSavingChange={onSavingChange}
                />
                <div className="gs-adv__block">
                  <div className="gs-adv__title">{t('本地指令包（Skill）与市场条目')}</div>
                  <div className="gs-note">{t('只对本群生效；与团队层、平台层同名时以群层为准。')}</div>
                  <SkillLayerList base={`/groups/${group.id}/skills`} tag={t('群层')} />
                  <InheritedSkillList groupId={group.id} />
                  <InstalledSection base={`/groups/${group.id}`} onLeave={inRouter ? onClose : undefined} />
                </div>
              </>
            )}
            {pluginsOn ? (
              <div className="gs-adv__block">
                <div className="gs-adv__title">{t('本地上传插件包（不走市场）')}</div>
                <GroupPluginsTab group={group} readOnly={readOnly} />
              </div>
            ) : null}
          </div>
        </Disclosure>
      ) : null}

      <Presence>
        {openConnectorId ? (
          <ConnectorDialog
            groupId={group.id}
            id={openConnectorId}
            inGroup={!dm}
            onClose={() => {
              setOpenConnectorId(null)
              void loadConnectors(group.id)
              if (pluginsOn) loadPlugins(group.id)
            }}
          />
        ) : null}
      </Presence>

      <Presence>
        {openNeeds && secretNeeds.data ? (
          <NeedsDialog
            groupId={group.id}
            needs={secretNeeds.data}
            onClose={() => setOpenNeeds(false)}
            onDone={() => {
              setOpenNeeds(false)
              secretNeeds.reload()
              if (pluginsOn) loadPlugins(group.id)
            }}
          />
        ) : null}
      </Presence>
    </div>
  )
}
