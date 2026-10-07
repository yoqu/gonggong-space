import type { BindCodeDto } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { useNow } from '../../lib/now'
import { countdown } from '../../lib/time'
import { Alert, Button, Disclosure, Form, FormRow, Icon, IconButton, Spinner } from '../../ui'
import './machines.css'
import { t } from '../../i18n'

export interface BindCode {
  code: BindCodeDto | null
  error: string
  remaining: number
  expired: boolean
  generate: () => Promise<void>
}

/** A one-time 接入链接, generated whenever `open` turns on; the countdown stops once `done`. */
export function useBindCode(open: boolean, done = false): BindCode {
  const [code, setCode] = useState<BindCodeDto | null>(null)
  const [error, setError] = useState('')
  const now = useNow(open && !!code && !done)

  const generate = useCallback(async () => {
    setCode(null)
    setError('')
    try {
      setCode(await api.post<BindCodeDto>('/bind-codes'))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    if (open) void generate()
  }, [open, generate])

  const remaining = code ? Date.parse(code.expiresAt) - now : 0
  return { code, error, remaining, expired: !!code && !done && remaining <= 0, generate }
}

export const loginCommand = (code: BindCodeDto) => `gg login --server ${location.origin} --code ${code.code}`

const copy = (text: string, message: string) => void copyWithToast(text, message)

/** 接入链接: open it in the desktop app, or copy it; the gg login command sits under 使用命令行. */
export function BindCodePanel({ bind }: { bind: BindCode }) {
  const { code, error, remaining, expired, generate } = bind
  const waiting = !!code && !expired
  return (
    <Form>
      <FormRow
        label={t('接入链接')}
        align="top"
        hint={waiting ? t('一次性接入链接 · {time} 后失效', { time: countdown(remaining) }) : undefined}
      >
        {expired ? (
          <span className="bind__code-line">
            <span className="bind__expired">{t('接入链接已失效')}</span>
            <Button size="small" onClick={() => void generate()}>
              {t('重新生成')}
            </Button>
          </span>
        ) : code ? (
          <div className="bind__open">
            <span className="bind__code-line">
              <a className="ui-btn ui-btn--primary bind__open-link" href={code.link}>
                {t('在客户端中打开')}
              </a>
              <Button onClick={() => copy(code.link, t('已复制接入链接'))}>{t('复制接入链接')}</Button>
            </span>
            <span className="bind__note">{t('没有自动打开？复制接入链接，粘贴到客户端。')}</span>
          </div>
        ) : error ? (
          <span className="bind__code-line">
            <Alert variant="error" description={error} />
            <Button size="small" onClick={() => void generate()}>
              {t('重试')}
            </Button>
          </span>
        ) : (
          <Spinner size={18} />
        )}
      </FormRow>
      <FormRow align="top">
        <Disclosure title={t('使用命令行')}>
          <div className="bind__cmd">
            <span className="bind__cmd-text">{code ? loginCommand(code) : '—'}</span>
            <IconButton
              title={t('复制命令')}
              disabled={!waiting}
              onClick={() => code && copy(loginCommand(code), t('已复制绑定命令'))}
            >
              <Icon name="copy" />
            </IconButton>
          </div>
          <p className="bind__note">{t('没有安装客户端时，在机器的终端里执行。')}</p>
        </Disclosure>
      </FormRow>
    </Form>
  )
}
