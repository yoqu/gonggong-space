import {
  type InstallScope,
  type MarketReadinessActionReq,
  type MarketReadinessActionRes,
  type MarketReadinessDto,
  type ReadinessSecretItemDto,
  type ReusedSecretDto,
  SECRET_MIN_LENGTH,
} from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Alert, Button, Checkbox, Icon, Link, SecureField, Spinner, toast } from '../../ui'
import { CliConnect } from '../connectors/CliConnect'
import { loadConnectors, useConnectorStore } from '../connectors/store'
import { secretsApi } from '../secrets/api'
import { openPromptInGroup } from './meta'

/**
 * Step 2 of the 2-step add modal: complete remaining setup in place (fill personal/shared secrets,
 * connect CLI account, approve own machine exec trust or notify owner), then celebrate with clickable
 * 「试试这样问」 prompts.
 */
export function InstallReadyStep({
  listingId,
  listingTitle,
  scope,
  scopeId,
  targetLabel,
  teamId,
  fallbackExamples = [],
  onDone,
  onGoInstalled,
  onChanged,
  onReusedSecrets,
  onTargetLabel,
}: {
  listingId: string
  listingTitle: string
  scope: InstallScope
  scopeId: string
  targetLabel: string
  teamId?: string
  fallbackExamples?: string[]
  onDone: () => void
  onGoInstalled?: () => void
  onChanged?: () => void
  onReusedSecrets?: (items: ReusedSecretDto[]) => void
  onTargetLabel?: (label: string) => void
}) {
  const navigate = useNavigate()
  const groups = useWorkspace((s) => s.groups)
  const teams = useSession((s) => s.tenancy?.teams) ?? []
  const path = `/market/${listingId}/readiness?scope=${encodeURIComponent(scope)}&scopeId=${encodeURIComponent(scopeId)}`
  const { data, error, loading, reload } = useGet<MarketReadinessDto>(path)

  const [values, setValues] = useState<Record<string, string>>({})
  const [foreign, setForeign] = useState<Record<string, boolean>>({})
  const [savingSecret, setSavingSecret] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [notified, setNotified] = useState<Record<string, boolean>>({})
  const [inlineErr, setInlineErr] = useState('')
  // The ready check only celebrates when this dialog saw a pending step get finished, not when it opened ready.
  const sawPending = useRef(false)

  const groupId = data?.connector?.groupId ?? (scope === 'group' ? scopeId : undefined)
  const groupConnectors = useConnectorStore((s) => (groupId ? s.lists[groupId] : undefined))
  const needsCli = !!data?.connector && data.connector.kind === 'cli' && !data.connector.ready
  useEffect(() => {
    if (groupId && needsCli) void loadConnectors(groupId)
  }, [groupId, needsCli])

  const onReusedRef = useRef(onReusedSecrets)
  onReusedRef.current = onReusedSecrets
  const onTargetLabelRef = useRef(onTargetLabel)
  onTargetLabelRef.current = onTargetLabel
  const reportedKeyRef = useRef('')
  useEffect(() => {
    const list = data?.reusedSecrets
    if (!list?.length) return
    const key = list.map((r) => `${r.name}:${r.existingScope}`).join('|')
    if (key === reportedKeyRef.current) return
    reportedKeyRef.current = key
    onReusedRef.current?.(list)
  }, [data?.reusedSecrets])
  useEffect(() => {
    if (data?.targetLabel) onTargetLabelRef.current?.(data.targetLabel)
  }, [data?.targetLabel])

  const cliConnector =
    groupId && groupConnectors
      ? groupConnectors.find(
          (c) =>
            (data?.connector?.driver && c.manifest.connector?.cli?.driver === data.connector.driver) ||
            c.manifest.title === listingTitle,
        )
      : undefined

  if (!data) {
    return error ? <Alert variant="error" title={error} retrying={loading} onRetry={reload} /> : <Spinner />
  }

  const missingSecrets = data.secrets.filter((s) => s.status !== 'ok')
  const codeDisabled = !!data.trusts && !data.trusts.codeEnabled
  const pendingTrusts =
    data.trusts && !data.trusts.ready ? data.trusts.machines.filter((m) => m.status !== 'allowed') : []
  const pendingConnector = data.connector && !data.connector.ready ? data.connector : null
  const pendingCount =
    data.pendingSteps ||
    (missingSecrets.length ? 1 : 0) +
      (codeDisabled || pendingTrusts.length ? 1 : 0) +
      (pendingConnector ? 1 : 0)
  const allReady = data.ready || pendingCount === 0
  if (!allReady) sawPending.current = true
  const prompts = data.tryPrompts.length ? data.tryPrompts : fallbackExamples
  const displayTarget = data.targetLabel || targetLabel

  const resolvedTeamId =
    teamId ||
    (scope === 'team'
      ? scopeId
      : scope === 'group'
        ? groups.find((g) => g.id === scopeId)?.teamId
        : (teams.find((x) => x.role !== 'member')?.id ?? teams[0]?.id))

  const saveSecret = async (item: ReadinessSecretItemDto) => {
    const val = (values[item.name] ?? '').trim()
    if (val.length < SECRET_MIN_LENGTH) {
      setInlineErr(t('{name} 至少需要 8 个字符', { name: item.title || item.name }))
      return
    }
    setSavingSecret(item.name)
    setInlineErr('')
    try {
      if (item.action === 'fill_personal') {
        if (item.defId) {
          await secretsApi.setMine(item.defId, {
            value: val,
            allowForeignMachines: !!foreign[item.name],
          })
        } else if (groupId) {
          await api.post(`/groups/${groupId}/secret-needs/personal`, {
            name: item.name,
            value: val,
            allowForeignMachines: !!foreign[item.name],
          })
        } else if (resolvedTeamId && teams.some((x) => x.id === resolvedTeamId && x.role !== 'member')) {
          const created = await secretsApi.create(`/teams/${resolvedTeamId}/secrets`, {
            name: item.name,
            description: [item.title, item.description].filter(Boolean).join('：'),
            mode: 'personal',
            botIds: null,
            enabled: true,
            expiresAt: null,
          })
          await secretsApi.setMine(created.id, {
            value: val,
            allowForeignMachines: !!foreign[item.name],
          })
        } else {
          setInlineErr(item.reason || t('凭据定义尚未就绪，请联系管理员处理'))
          return
        }
      } else if (item.action === 'fill_shared' && item.defId) {
        await secretsApi.update(item.defId, { value: val })
      } else if (item.action === 'create_and_fill') {
        const secretsBase =
          scope === 'group'
            ? `/groups/${scopeId}/secrets`
            : scope === 'team'
              ? `/teams/${scopeId}/secrets`
              : resolvedTeamId
                ? `/teams/${resolvedTeamId}/secrets`
                : null
        if (!secretsBase) {
          setInlineErr(item.reason || t('凭据定义尚未就绪，请联系管理员处理'))
          return
        }
        const created = await secretsApi.create(secretsBase, {
          name: item.name,
          description: [item.title, item.description].filter(Boolean).join('：'),
          mode: item.mode,
          botIds: null,
          enabled: true,
          expiresAt: null,
          ...(item.mode === 'personal' ? {} : { value: val }),
        })
        if (item.mode === 'personal') {
          await secretsApi.setMine(created.id, {
            value: val,
            allowForeignMachines: !!foreign[item.name],
          })
        }
      } else {
        setInlineErr(item.reason || t('凭据定义尚未就绪，请联系管理员处理'))
        return
      }
      toast({ type: 'success', message: t('已保存「{name}」', { name: item.title || item.name }) })
      reload()
      onChanged?.()
    } catch (e) {
      setInlineErr(errorText(e))
    } finally {
      setSavingSecret(null)
    }
  }

  const runReadinessAction = async (
    action: MarketReadinessActionReq['action'],
    machineId: string,
    label: string,
    ownerName?: string,
  ) => {
    const key = `${action}:${machineId}`
    setActionBusy(key)
    setInlineErr('')
    try {
      const req: MarketReadinessActionReq = {
        action,
        machineId,
        scope,
        scopeId,
        versionId: data.versionId,
      }
      const res = await api.post<MarketReadinessActionRes>(`/market/${listingId}/readiness/action`, req)
      if (action === 'allow_trust') {
        toast({ type: 'success', message: t('已允许在「{machine}」上运行', { machine: label }) })
        reload()
        onChanged?.()
      } else {
        setNotified((prev) => ({ ...prev, [key]: true }))
        if (res?.notified === false) {
          toast({
            type: 'info',
            message: t('该电脑主人之前已拒绝或已收到提醒，未重复发送'),
          })
        } else if (action === 'notify_connector') {
          toast({
            type: 'success',
            message: ownerName ? t('已提醒 {owner} 连接账号', { owner: ownerName }) : t('已发送连接账号提醒'),
          })
        } else {
          toast({
            type: 'success',
            message: ownerName ? t('已提醒 {owner} 完成授权', { owner: ownerName }) : t('已发送授权提醒'),
          })
        }
      }
    } catch (e) {
      toastError(e)
    } finally {
      setActionBusy(null)
    }
  }

  if (allReady) {
    return (
      <>
        <div className="mkt-done-hero">
          <div className="mkt-done-hero__icon" aria-hidden="true">
            <span className={cx('mkt-steps__check', sawPending.current && 'ui-check-pop')}>
              <Icon name="check" size={26} weight={2} />
            </span>
          </div>
          <h3 className="mkt-done-hero__title">{t('已就绪，可以用了')}</h3>
          <p className="mkt-done-hero__sub">
            {scope === 'group'
              ? t('「{target}」里的 Bot 现在可以直接帮你干活了', { target: displayTarget })
              : t('「{name}」已添加到「{target}」，现在就可以开始使用', {
                  name: listingTitle,
                  target: displayTarget,
                })}
          </p>
        </div>

        {prompts.length ? (
          <div className="mkt-rise-in">
            <div className="cfg__eyebrow">{t('点一句，直接带回群里试一试')}</div>
            <div className="mkt-try-box">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="mkt-try-btn"
                  onClick={() => {
                    onDone()
                    openPromptInGroup(prompt, groupId ?? undefined, navigate)
                  }}
                >
                  <span>“{prompt}”</span>
                  <span className="mkt-try-btn__arrow" aria-hidden="true">
                    <Icon name="chevron-right" size={14} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mkt-create-foot">
          {onGoInstalled ? (
            <Button
              onClick={() => {
                onDone()
                onGoInstalled()
              }}
            >
              {t('去已添加')}
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={() => {
              onDone()
              if (groupId) navigate(`/g/${groupId}`)
            }}
          >
            {groupId ? t('去群里使用') : t('完成')}
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      {inlineErr ? <Alert variant="error" title={inlineErr} /> : null}
      <div className="mkt-ready-banner">
        <Icon name="check" size={15} />
        <span>
          {t('已添加到「{target}」，还差 {n} 步就能用', { target: displayTarget, n: pendingCount })}
        </span>
      </div>
      <div className="mkt-row__meta">{t('只列出还没做的步骤，做完会自动打勾')}</div>

      <div className="mkt-checklist">
        <div className="mkt-check-item">
          <span className="mkt-check-dot mkt-check-dot--ok" aria-hidden="true">
            <Icon name="check" size={13} weight={2} />
          </span>
          <div>
            <div className="mkt-check-title">{t('已添加到「{target}」', { target: displayTarget })}</div>
            <div className="mkt-check-sub">
              {scope === 'user' ? t('随你进入所有群生效') : t('群里所有 Bot 都能用')}
            </div>
          </div>
        </div>

        {missingSecrets.map((s) => {
          const canFill =
            s.action === 'fill_personal' || s.action === 'fill_shared' || s.action === 'create_and_fill'
          return (
            <div key={s.name} className="mkt-check-item">
              <span className="mkt-check-dot" aria-hidden="true">
                <Icon name="lock" size={13} />
              </span>
              <div>
                <div className="mkt-check-title">{t('填写你的 {name}', { name: s.title || s.name })}</div>
                <div className="mkt-check-sub">
                  {s.mode === 'personal'
                    ? t('每人填自己的，加密保存，别人看不到。')
                    : t('群内共用凭据，加密保存。')}
                  {s.url ? (
                    <>
                      {' '}
                      <Link external href={s.url}>
                        {t('如何获取')}
                      </Link>
                    </>
                  ) : null}
                </div>
                {canFill ? (
                  <>
                    <div className="mkt-check-field">
                      <SecureField
                        aria-label={s.title || s.name}
                        autoComplete="new-password"
                        placeholder={s.placeholder ?? t('输入凭据值（至少 8 位）')}
                        value={values[s.name] ?? ''}
                        onChange={(e) => {
                          setValues((v) => ({ ...v, [s.name]: e.target.value }))
                          setInlineErr('')
                        }}
                      />
                      <Button
                        size="small"
                        variant="primary"
                        loading={savingSecret === s.name}
                        disabled={savingSecret !== null}
                        onClick={() => void saveSecret(s)}
                      >
                        {t('保存并验证')}
                      </Button>
                    </div>
                    {s.mode === 'personal' ? (
                      <div className="mkt-check-sub">
                        <Checkbox
                          label={t('允许在他人的电脑上使用我的凭据')}
                          checked={!!foreign[s.name]}
                          onChange={(on) => setForeign((prev) => ({ ...prev, [s.name]: on }))}
                        />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="mkt-check-sub">
                    {s.reason || t('请联系团队管理员先创建并填写这项凭据。')}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {pendingConnector ? (
          <div className="mkt-check-item">
            <span className="mkt-check-dot" aria-hidden="true">
              <Icon name="link" size={13} />
            </span>
            <div>
              <div className="mkt-check-title">{t('连接你的外部账号')}</div>
              <div className="mkt-check-sub">
                {pendingConnector.loginPrompt ||
                  t('每台电脑使用机主本人的账号登录，授权仅保存在你的电脑本地，不会上传服务器。')}
              </div>
              {groupId && cliConnector?.cli ? (
                <div style={{ marginTop: 'var(--space-10)' }}>
                  <CliConnect
                    groupId={groupId}
                    c={cliConnector}
                    cli={cliConnector.cli}
                    onTry={(prompt) => {
                      onDone()
                      openPromptInGroup(prompt, groupId, navigate)
                    }}
                  />
                </div>
              ) : (
                pendingConnector.machines.map((m) => {
                  const notifyKey = `notify_connector:${m.machineId}`
                  return (
                    <div key={m.machineId} className="mkt-machine-row">
                      <span className="mkt-machine-who">
                        <Icon name="laptop" size={15} />
                        <span>
                          <strong className="mkt-row__name">{m.machineName}</strong>
                          <span className="mkt-row__meta">
                            {m.state === 'ready'
                              ? m.account
                                ? t('已连接 · {account}', { account: m.account })
                                : t('已就绪')
                              : m.own
                                ? t('待连接账号')
                                : t('需由机主 {owner} 连接', { owner: m.ownerName })}
                          </span>
                        </span>
                      </span>
                      {m.state === 'ready' ? (
                        <span className="mkt-pcard__src mkt-pcard__src--official">{t('已就绪')}</span>
                      ) : m.own ? (
                        <Button
                          size="small"
                          variant="primary"
                          onClick={() => {
                            if (groupId) void loadConnectors(groupId)
                            reload()
                          }}
                        >
                          {t('去连接')}
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          className="mkt-btn-soft"
                          icon="bell"
                          loading={actionBusy === notifyKey}
                          disabled={actionBusy !== null || !!notified[notifyKey]}
                          onClick={() =>
                            void runReadinessAction(
                              'notify_connector',
                              m.machineId,
                              m.machineName,
                              m.ownerName,
                            )
                          }
                        >
                          {notified[notifyKey]
                            ? t('已提醒')
                            : t('通知{owner}连接', { owner: m.ownerName || t('机主') })}
                        </Button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : null}

        {codeDisabled ? (
          <div className="mkt-check-item">
            <span className="mkt-check-dot" aria-hidden="true">
              <Icon name="lock" size={13} />
            </span>
            <div>
              <div className="mkt-check-title">{t('需管理员开启「插件运行本机程序」')}</div>
              <div className="mkt-check-sub">
                {t('当前系统未开启插件运行本机程序，请联系系统管理员在管理后台开启后再使用。')}
              </div>
            </div>
          </div>
        ) : null}

        {pendingTrusts.length ? (
          <div className="mkt-check-item">
            <span className="mkt-check-dot" aria-hidden="true">
              <Icon name="laptop" size={13} />
            </span>
            <div>
              <div className="mkt-check-title">{t('允许 Bot 所在的电脑使用这个插件')}</div>
              <div className="mkt-check-sub">
                {t('含本机程序的插件需要电脑主人确认一次，版本不变不再询问')}
              </div>
              {pendingTrusts.map((m) => {
                const allowKey = `allow_trust:${m.machineId}`
                const notifyKey = `notify_trust:${m.machineId}`
                return (
                  <div key={m.machineId} className="mkt-machine-row">
                    <span className="mkt-machine-who">
                      <Icon name="laptop" size={15} />
                      <span>
                        <strong className="mkt-row__name">{m.machineName}</strong>
                        {m.botNames.length ? (
                          <span className="mkt-row__meta">
                            {t('{bots} 运行在这台电脑上', { bots: m.botNames.join(t('、')) })}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {m.own ? (
                      <Button
                        size="small"
                        variant="primary"
                        loading={actionBusy === allowKey}
                        disabled={actionBusy !== null}
                        onClick={() =>
                          void runReadinessAction('allow_trust', m.machineId, m.machineName, m.ownerName)
                        }
                      >
                        {t('立即允许')}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        className="mkt-btn-soft"
                        icon="bell"
                        loading={actionBusy === notifyKey}
                        disabled={actionBusy !== null || !!notified[notifyKey]}
                        onClick={() =>
                          void runReadinessAction('notify_trust', m.machineId, m.machineName, m.ownerName)
                        }
                      >
                        {notified[notifyKey]
                          ? t('已提醒')
                          : t('通知{owner}授权', { owner: m.ownerName || t('机主') })}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mkt-create-foot">
        <Button onClick={onDone}>{t('稍后配置')}</Button>
        <Button variant="primary" onClick={reload}>
          {t('刷新检查')}
        </Button>
      </div>
    </>
  )
}
