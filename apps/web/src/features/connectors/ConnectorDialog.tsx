import { type ConnectorDto, SECRET_MIN_LENGTH, secretSpecsOf } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  Dialog,
  Icon,
  Link,
  Logo,
  Presence,
  SecureField,
  Switch,
  toast,
} from '../../ui'
import { PluginTile, pluginIcon } from '../plugins/PluginTile'
import { CliConnect } from './CliConnect'
import { ConnectorStatusLine, needsConnect } from './ConnectorStatus'
import { checkConnector, connect, disconnect, switchConnector, useConnectorStore } from './store'
import '../config/config.css'
import '../secrets/secrets.css'
import './connectors.css'

/** A pasted key as the system wants it: no stray spaces, no `Bearer ` copied along from a header. */
const keyOf = (v: string) => v.trim().replace(/^Bearer\s+/i, '')

/**
 * A connector's details: connect with my own keys, or 去试试 / 解绑 once connected; 试试这样用 fills an example into
 * the composer (`onTry`), never sends it.
 */
export function ConnectorDialog({
  groupId,
  id,
  inGroup,
  domains,
  machineId,
  onTry,
  onClose,
}: {
  groupId: string
  id: string
  /** A group, not a dm: others there see what the bot answers with my account. */
  inGroup: boolean
  /** CLI connectors: log in for only these Feishu domains (a 就地连接 card). */
  domains?: string[]
  /** CLI connectors: connect on this machine (a 就地连接 card's). */
  machineId?: string | null
  /** Absent where there is no composer to fill (a 就地连接 card). */
  onTry?: (c: ConnectorDto, text: string) => void
  onClose: () => void
}) {
  const c = useConnectorStore((s) => s.lists[groupId]?.find((x) => x.id === id))
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unbinding, setUnbinding] = useState(false)
  const [checking, setChecking] = useState(false)
  const attempt = async (f: () => Promise<unknown>) => {
    setError('')
    try {
      await f()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const recheck = async () => {
    setChecking(true)
    await attempt(() => checkConnector(groupId, id))
    setChecking(false)
  }
  if (!c) return null
  const m = c.manifest
  const examples = m.connector?.examples ?? []
  const specs = secretSpecsOf(m)
  // Expired: asks the required keys again, filled or not.
  const asked = c.missing.length ? c.missing : specs.filter((x) => x.required).map((x) => x.name)
  const ready = asked.every((n) => keyOf(values[n] ?? '').length >= SECRET_MIN_LENGTH)
  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const done = await connect(
        groupId,
        c.id,
        Object.fromEntries(Object.entries(values).map(([k, v]) => [k, keyOf(v)])),
      )
      setValues({})
      if (done.status === 'expired')
        setError(t('「{name}」拒绝了这个密钥，请确认后重新填写', { name: m.title }))
      else toast({ type: 'success', message: t('已连接「{name}」', { name: m.title }) })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      aria-label={m.title}
      width={560}
      closeOnBackdrop={!Object.keys(values).length}
      onClose={onClose}
    >
      <div className="cn-detail">
        <div className="cn-detail__hero" aria-hidden="true">
          <span className="cn-detail__mark">
            <Logo size={44} />
          </span>
          <span className="cn-detail__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="cn-detail__mark">
            <PluginTile m={m} size={56} src={pluginIcon(c)} />
          </span>
        </div>
        <h2 className="cn-detail__title">{t('连接 {name}', { name: m.title })}</h2>
        {m.description ? <p className="cn-detail__desc">{m.description}</p> : null}
        {(c.personal || m.connector?.login || c.cli) && inGroup ? (
          <div className="cn-detail__note">
            <Icon name="eye" size={13} />
            {t('用你自己的账号连接，Bot 的回复群内可见')}
          </div>
        ) : null}
        {!c.cli && c.status === 'unconnected' ? null : (
          <div className="cn-detail__state">
            <ConnectorStatusLine c={c} />
            {c.connected && m.connector?.check && !m.connector.login ? (
              <Button size="small" variant="plain" loading={checking} onClick={() => void recheck()}>
                {t('重新检测')}
              </Button>
            ) : null}
            {!needsConnect(c) ? (
              <Switch
                size="small"
                label={t('在本群启用')}
                checked={c.on}
                onChange={(on) => void attempt(() => switchConnector(groupId, c.id, on))}
              />
            ) : null}
          </div>
        )}
        {error ? <Alert variant="error" title={error} /> : null}
        {c.cli ? (
          <CliConnect
            groupId={groupId}
            c={c}
            cli={c.cli}
            domains={domains}
            machineId={machineId}
            onTry={onTry && ((x) => onTry(c, x))}
          />
        ) : m.connector?.login ? (
          onTry ? (
            <>
              <div className="gs-note">
                {t(
                  '用你自己的账号在对话里登录：Bot 发来授权链接，你在浏览器里同意即可。登录信息只保存在 Bot 所在电脑的命令行工具里。',
                )}
              </div>
              <div className="cn-detail__actions">
                {c.status === 'ok' && examples[0] ? (
                  <>
                    <Button
                      size="large"
                      variant="primary"
                      icon="bubble"
                      onClick={() => onTry(c, examples[0]!)}
                    >
                      {t('去试试')}
                    </Button>
                    <Button size="large" onClick={() => onTry(c, m.connector!.login!)}>
                      {t('重新登录')}
                    </Button>
                  </>
                ) : (
                  <Button size="large" variant="primary" onClick={() => onTry(c, m.connector!.login!)}>
                    {c.status === 'expired' ? t('在对话里重新登录') : t('在对话里连接')}
                  </Button>
                )}
              </div>
            </>
          ) : null
        ) : c.connected && c.status !== 'expired' ? (
          <div className="cn-detail__actions">
            <Button
              size="large"
              variant="primary"
              disabled={!examples[0] || !onTry}
              icon="bubble"
              onClick={() => examples[0] && onTry?.(c, examples[0])}
            >
              {t('去试试')}
            </Button>
            {c.personal ? (
              <Button size="large" icon="plug" onClick={() => setUnbinding(true)}>
                {t('解绑')}
              </Button>
            ) : null}
          </div>
        ) : c.missing.length || c.status === 'expired' ? (
          <div className="cn-detail__form">
            {asked.map((n) => {
              const spec = specs.find((s) => s.name === n)
              const val = values[n] ?? ''
              const short = val.length > 0 && keyOf(val).length < SECRET_MIN_LENGTH
              return (
                <div key={n} className="sn-row">
                  <div className="sn-row__head">
                    <strong>{spec?.title ?? n}</strong>
                    {spec?.title ? <code>{n}</code> : null}
                  </div>
                  {spec?.description ? <div className="gs-desc">{spec.description}</div> : null}
                  <SecureField
                    aria-label={n}
                    autoComplete="new-password"
                    placeholder={spec?.placeholder || t('输入 {name} 的值', { name: n })}
                    error={short ? t('至少 8 个字符') : undefined}
                    value={val}
                    onChange={(e) => setValues({ ...values, [n]: e.target.value })}
                  />
                </div>
              )
            })}
            <div className="gs-note">
              {t(
                '加密保存为你的个人密钥，将允许群内 Bot 在他人机器上使用（群里的 Bot 很少跑在你自己的电脑上）',
              )}
            </div>
            <div className="cn-detail__actions">
              <Button
                size="large"
                variant="primary"
                disabled={!ready || busy}
                loading={busy}
                onClick={() => void submit()}
              >
                {t('连接')}
              </Button>
              {m.connector?.docs ? (
                <Link external href={m.connector.docs}>
                  {t('如何获取')}
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <Alert
            variant="info"
            title={t('待管理员配置')}
            description={t('这个连接器使用团队统一的账号，需要团队管理员在团队密钥里填写')}
          />
        )}
        {examples.length && onTry ? (
          <section className="cn-detail__tries" aria-label={t('试试这样用')}>
            <h3 className="cn-detail__tries-title">
              <Icon name="sparkle" size={15} />
              {t('试试这样用')}
            </h3>
            {examples.map((x) => (
              <button key={x} type="button" className="cn-try" aria-label={x} onClick={() => onTry(c, x)}>
                <span>“{x}”</span>
                <Icon name="bubble" size={16} />
              </button>
            ))}
          </section>
        ) : null}
      </div>
      <Presence>
        {unbinding ? (
          <ConfirmActionDialog
            title={t('解绑「{name}」？', { name: m.title })}
            message={t('将删除你在本团队填写的密钥，所有群里的 Bot 都不能再用你的账号访问「{name}」。', {
              name: m.title,
            })}
            consequences={
              c.sharedWith.length
                ? [t('这些也会一起断开：{names}', { names: c.sharedWith.join(t('、')) })]
                : []
            }
            label={t('解绑')}
            done={t('已解绑「{name}」', { name: m.title })}
            run={() => disconnect(groupId, c.id)}
            onClose={() => setUnbinding(false)}
          />
        ) : null}
      </Presence>
    </Dialog>
  )
}
