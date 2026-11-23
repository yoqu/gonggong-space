import type { ConnectorDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'

type Tone = 'ok' | 'bad' | 'warn' | 'idle'

/** What the connection's status reads as, and its dot. */
export function connectorStatus(c: ConnectorDto): { tone: Tone; text: string } {
  const cli = !!c.manifest.connector?.login
  switch (c.status) {
    case 'ok':
      return {
        tone: 'ok',
        text: c.account ? t('已连接 · {account}', { account: c.account }) : t('已连接'),
      }
    case 'expired':
      return { tone: 'bad', text: cli ? t('登录已过期') : t('密钥已失效') }
    case 'error':
      return { tone: 'warn', text: t('暂时无法检测') }
    case 'unchecked':
      return { tone: 'idle', text: cli ? t('未确认登录') : t('检测中…') }
    case 'unconnected':
      return { tone: 'idle', text: c.missing.length ? t('未连接') : t('待管理员配置') }
  }
}

/** Needs the person to connect (again): never connected, or the system refused the key / login. */
export const needsConnect = (c: ConnectorDto) =>
  c.status === 'expired' ||
  (c.status === 'unconnected' && c.missing.length > 0) ||
  (!!c.manifest.connector?.login && c.status === 'unchecked')

export function ConnectorStatusLine({ c, className }: { c: ConnectorDto; className?: string }) {
  const s = connectorStatus(c)
  return (
    <span className={cx('cn-status', `cn-status--${s.tone}`, className)}>
      <span className="cn-status__dot" aria-hidden="true" />
      {!c.on && c.status === 'ok' ? t('本群已停用') : s.text}
    </span>
  )
}
