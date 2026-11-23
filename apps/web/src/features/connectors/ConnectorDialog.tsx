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
  toast,
} from '../../ui'
import { PluginTile, pluginIcon } from '../plugins/PluginTile'
import { connect, disconnect, useConnectorStore } from './store'
import '../config/config.css'
import '../secrets/secrets.css'
import './connectors.css'

/**
 * A connector's details: connect with my own keys, or 去试试 / 解绑 once connected; 试试这样用 fills an example into
 * the composer (`onTry`), never sends it.
 */
export function ConnectorDialog({
  groupId,
  id,
  inGroup,
  onTry,
  onClose,
}: {
  groupId: string
  id: string
  /** A group, not a dm: others there see what the bot answers with my account. */
  inGroup: boolean
  onTry: (c: ConnectorDto, text: string) => void
  onClose: () => void
}) {
  const c = useConnectorStore((s) => s.lists[groupId]?.find((x) => x.id === id))
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unbinding, setUnbinding] = useState(false)
  if (!c) return null
  const m = c.manifest
  const examples = m.connector?.examples ?? []
  const specs = secretSpecsOf(m)
  const ready = c.missing.every((n) => (values[n]?.length ?? 0) >= SECRET_MIN_LENGTH)
  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await connect(groupId, c.id, values)
      setValues({})
      toast({ type: 'success', message: t('已连接「{name}」', { name: m.title }) })
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
      width={480}
      closeOnBackdrop={!Object.keys(values).length}
      onClose={onClose}
    >
      <div className="cn-detail">
        <div className="cn-detail__hero" aria-hidden="true">
          <Logo size={40} />
          <span className="cn-detail__dots">···</span>
          <PluginTile m={m} size={40} src={pluginIcon(c)} />
        </div>
        <h2 className="cn-detail__title">{m.title}</h2>
        {m.description ? <p className="cn-detail__desc">{m.description}</p> : null}
        {(c.personal || m.connector?.login) && inGroup ? (
          <div className="cn-detail__note">
            <Icon name="eye" size={13} />
            {t('用你自己的账号连接，Bot 的回复群内可见')}
          </div>
        ) : null}
        {error ? <Alert variant="error" title={error} /> : null}
        {m.connector?.login ? (
          <>
            <div className="gs-note">
              {t(
                '用你自己的账号在对话里登录：Bot 发来授权链接，你在浏览器里同意即可。登录信息只保存在 Bot 所在电脑的命令行工具里。',
              )}
            </div>
            <div className="cn-detail__actions">
              <Button variant="primary" onClick={() => onTry(c, m.connector!.login!)}>
                {t('在对话里连接')}
              </Button>
              {examples[0] ? <Button onClick={() => onTry(c, examples[0]!)}>{t('去试试')}</Button> : null}
            </div>
          </>
        ) : c.connected ? (
          <div className="cn-detail__actions">
            <Button
              variant="primary"
              disabled={!examples[0]}
              onClick={() => examples[0] && onTry(c, examples[0])}
            >
              {t('去试试')}
            </Button>
            {c.personal ? <Button onClick={() => setUnbinding(true)}>{t('解绑')}</Button> : null}
          </div>
        ) : c.missing.length ? (
          <div className="cn-detail__form">
            {c.missing.map((n) => {
              const spec = specs.find((s) => s.name === n)
              const val = values[n] ?? ''
              const short = val.length > 0 && val.length < SECRET_MIN_LENGTH
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
        {examples.length ? (
          <section className="cn-detail__tries" aria-label={t('试试这样用')}>
            <div className="cfg__eyebrow">{t('试试这样用')}</div>
            {examples.map((x) => (
              <button key={x} type="button" className="cn-try" onClick={() => onTry(c, x)}>
                <span>{x}</span>
                <Icon name="arrow-turn-down-right" size={14} />
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
