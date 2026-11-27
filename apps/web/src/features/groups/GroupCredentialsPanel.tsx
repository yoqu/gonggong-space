import { type ConnectorDto, type GroupDto, type SecretNeedDto, secretSpecsOf } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { Button, Disclosure, GroupBox, GroupRow, Icon, Presence, Tag } from '../../ui'
import { ConnectorDialog } from '../connectors/ConnectorDialog'
import { connectorStatus, needsConnect } from '../connectors/ConnectorStatus'
import { loadConnectors, useConnectors } from '../connectors/store'
import { PluginTile, pluginIcon } from '../plugins/PluginTile'
import { loadPlugins } from '../plugins/store'
import { GroupSecrets } from '../secrets/GroupSecrets'
import { NeedsDialog } from '../secrets/SecretNeeds'

function connectorCredentialSummary(c: ConnectorDto) {
  if (c.cli) {
    const ready = c.cli.machines.filter((m) => m.state === 'ready').map((m) => m.machineName)
    const missing = c.cli.machines.filter((m) => m.state !== 'ready').map((m) => m.machineName)
    const parts = [
      ready.length ? t('{names} 已连接', { names: ready.join(t('、')) }) : '',
      missing.length ? t('{names} 未连接', { names: missing.join(t('、')) }) : '',
      t('谁的电脑谁连接，本地登录不上传'),
    ].filter(Boolean)
    return parts.join(' · ')
  }
  return c.personal
    ? t('每人一份，加密保存，允许群内 Bot 在你触发时使用')
    : t('团队统一凭据，由管理员配置后全群共享')
}

function connectorBadge(c: ConnectorDto): { label: string; tone: 'green' | 'orange' | 'gray' } {
  const s = connectorStatus(c)
  if (s.tone === 'ok') return { label: s.text, tone: 'green' }
  if (c.status === 'expired') return { label: s.text, tone: 'orange' }
  if (needsConnect(c)) return { label: c.cli ? t('待连接账号') : t('你尚未填写'), tone: 'orange' }
  if (!c.cli && !c.connected) return { label: t('待管理员配置'), tone: 'orange' }
  return { label: s.text, tone: s.tone === 'warn' ? 'orange' : 'gray' }
}

function needBadge(n: SecretNeedDto): { label: string; tone: 'green' | 'orange' | 'gray' } {
  if (n.status === 'ok') {
    return {
      label: n.mine ? t('已配置 · 尾号 {last4}', { last4: n.mine.last4 }) : t('已配置'),
      tone: 'green',
    }
  }
  if (n.status === 'blocked') return { label: n.reason ?? t('暂不可用'), tone: 'orange' }
  if (n.action === 'fill_personal' || n.action === 'fill_new')
    return { label: t('你尚未填写'), tone: 'orange' }
  return { label: t('待管理员填写'), tone: 'orange' }
}

/**
 * 群设置 · 凭据与授权: plain-language group-scoped view of plugin secrets and machine connector logins,
 * with raw env var management tucked inside a default-collapsed advanced section.
 */
export function GroupCredentialsPanel({
  group,
  readOnly,
  initialRawSecrets = false,
}: {
  group: GroupDto
  readOnly: boolean
  initialRawSecrets?: boolean
}) {
  const pluginsOn = useSession((s) => !!s.tenancy?.pluginsEnabled)
  const connectors = useConnectors(group.id, pluginsOn)
  const needs = useGet<SecretNeedDto[]>(`/groups/${group.id}/secret-needs`)
  const [openConnectorId, setOpenConnectorId] = useState<string | null>(null)
  const [openNeeds, setOpenNeeds] = useState(false)

  const enabledConnectors = (connectors ?? []).filter((c) => c.enabledInGroup)
  const coveredSecrets = new Set(
    enabledConnectors.flatMap((c) => [
      ...c.manifest.secrets,
      ...secretSpecsOf(c.manifest).map((s) => s.name),
    ]),
  )

  const seenNeeds = new Set<string>()
  const extraNeeds = (needs.data ?? []).filter((n) => {
    if (coveredSecrets.has(n.spec.name) || seenNeeds.has(n.spec.name)) return false
    seenNeeds.add(n.spec.name)
    return true
  })

  const hasItems = enabledConnectors.length > 0 || extraNeeds.length > 0

  return (
    <div className="gs-cap">
      {readOnly ? (
        <div className="gs-ro-tip" role="note">
          {t('你是普通成员：可以填写或更新自己的个人凭据与电脑账号授权；统一凭据由管理员维护。')}
        </div>
      ) : null}

      <section className="gs-cap-sec" aria-label={t('本群插件用到的凭据与账号')}>
        <h3 className="gs-section-title">{t('本群插件用到的凭据与账号')}</h3>
        {hasItems ? (
          <GroupBox>
            {enabledConnectors.map((c) => {
              const badge = connectorBadge(c)
              const specTitle = secretSpecsOf(c.manifest)[0]?.title
              const title = c.cli
                ? t('{name} · 电脑账号授权', { name: c.manifest.title })
                : specTitle
                  ? `${c.manifest.title} · ${specTitle}`
                  : t('{name} · 账号凭据', { name: c.manifest.title })
              const actionLabel = needsConnect(c)
                ? c.cli
                  ? t('连接我的电脑')
                  : t('填写凭据')
                : t('查看状态')
              return (
                <GroupRow
                  key={c.id}
                  className="cfg__item"
                  label={
                    <div className="gs-cap-row">
                      <PluginTile m={c.manifest} size={32} src={pluginIcon(c)} />
                      <div className="gs-cap-row__text">
                        <span className="gs-cap-row__title">
                          <strong>{title}</strong>
                          <Tag tone={badge.tone}>{badge.label}</Tag>
                        </span>
                        <span className="gs-desc">{connectorCredentialSummary(c)}</span>
                      </div>
                    </div>
                  }
                >
                  <Button
                    size="small"
                    variant={needsConnect(c) ? 'primary' : 'default'}
                    onClick={() => setOpenConnectorId(c.id)}
                  >
                    {actionLabel}
                  </Button>
                </GroupRow>
              )
            })}
            {extraNeeds.map((n) => {
              const badge = needBadge(n)
              const title = `${n.skill} · ${n.spec.title ?? n.spec.name}`
              return (
                <GroupRow
                  key={`${n.skill}:${n.spec.name}`}
                  className="cfg__item"
                  label={
                    <div className="gs-cap-row">
                      <span className="gs-cap-tile" aria-hidden="true">
                        <Icon name="lock" size={15} />
                      </span>
                      <div className="gs-cap-row__text">
                        <span className="gs-cap-row__title">
                          <strong>{title}</strong>
                          <Tag tone={badge.tone}>{badge.label}</Tag>
                        </span>
                        <span className="gs-desc">
                          {n.spec.description || t('加密保存，仅用于对应插件在 Bot 运行时调用')}
                        </span>
                      </div>
                    </div>
                  }
                >
                  {n.action ? (
                    <Button
                      size="small"
                      variant={n.status === 'ok' ? 'default' : 'primary'}
                      onClick={() => setOpenNeeds(true)}
                    >
                      {n.status === 'ok' ? t('更新凭据') : t('填写凭据')}
                    </Button>
                  ) : null}
                </GroupRow>
              )
            })}
          </GroupBox>
        ) : (
          <div className="gs-note">{t('本群当前插件无需额外凭据或账号授权。')}</div>
        )}
      </section>

      <Disclosure
        variant="group"
        defaultOpen={initialRawSecrets}
        title={t('高级：底层环境变量明细（含自定义密钥与冲突沿用）')}
      >
        <div className="gs-adv">
          <GroupSecrets group={group} editable={!readOnly} />
        </div>
      </Disclosure>

      <Presence>
        {openConnectorId ? (
          <ConnectorDialog
            groupId={group.id}
            id={openConnectorId}
            inGroup={group.kind !== 'dm'}
            onClose={() => {
              setOpenConnectorId(null)
              void loadConnectors(group.id)
              if (pluginsOn) loadPlugins(group.id)
            }}
          />
        ) : null}
      </Presence>

      <Presence>
        {openNeeds && needs.data ? (
          <NeedsDialog
            groupId={group.id}
            needs={needs.data}
            onClose={() => setOpenNeeds(false)}
            onDone={() => {
              setOpenNeeds(false)
              needs.reload()
              if (pluginsOn) loadPlugins(group.id)
            }}
          />
        ) : null}
      </Presence>
    </div>
  )
}
