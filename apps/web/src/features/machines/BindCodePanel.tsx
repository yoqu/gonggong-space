import type { BindCodeDto } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../../lib/api'
import { copyText, copyWithToast } from '../../lib/clipboard'
import { useNow } from '../../lib/now'
import { countdown } from '../../lib/time'
import { Alert, Button, Disclosure, Form, FormRow, Icon, IconButton, Spinner, toast } from '../../ui'
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

export const dockerEnv = (code: BindCodeDto) => `GONGGONG_BIND_URL='${code.link}'`

const copy = (text: string, message: string) => void copyWithToast(text, message)

/**
 * 发给你的 Agent (Agent 自助接入): the sentence to paste to a local Claude Code / Codex, which installs gg, binds this
 * machine and gets its bot made by itself.
 */
export function AgentPrompt({ bind }: { bind: BindCode }) {
  const { code, error, remaining, expired, generate } = bind
  /** The code whose sentence was copied: a new code is a new sentence to copy. */
  const [copied, setCopied] = useState<string | null>(null)
  if (error)
    return (
      <span className="bind__code-line">
        <Alert variant="error" description={error} />
        <Button size="small" onClick={() => void generate()}>
          {t('重试')}
        </Button>
      </span>
    )
  if (!code) return <Spinner size={18} />
  if (expired)
    return (
      <span className="bind__code-line">
        <span className="bind__expired">{t('接入码已失效')}</span>
        <Button size="small" onClick={() => void generate()}>
          {t('重新生成')}
        </Button>
      </span>
    )
  return (
    <div className="bind__prompt-card">
      <p className="bind__prompt">{code.agentPrompt}</p>
      <span className="bind__code-line">
        <Button
          variant="primary"
          onClick={() =>
            void copyText(code.agentPrompt).then(
              () => setCopied(code.code),
              () => toast({ type: 'error', message: t('复制失败') }),
            )
          }
        >
          {copied === code.code ? t('已复制') : t('复制')}
        </Button>
        <span className="bind__note">
          {t('一次性接入码 · {time} 后失效', { time: countdown(remaining) })}
        </span>
      </span>
      <p className="bind__note">
        {t(
          '粘贴给本机的 Claude Code、Codex 等，它会自己安装 gg、绑定这台机器、建好 Bot。支持 macOS 和 Linux。',
        )}
      </p>
    </div>
  )
}

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
      <FormRow align="top">
        <Disclosure title={t('在 Docker 中运行')}>
          <div className="bind__cmd">
            <span className="bind__cmd-text">{code ? dockerEnv(code) : '—'}</span>
            <IconButton
              title={t('复制')}
              disabled={!waiting}
              onClick={() => code && copy(dockerEnv(code), t('已复制'))}
            >
              <Icon name="copy" />
            </IconButton>
          </div>
          <p className="bind__note">
            {t(
              '在服务器的 docker/daemon 目录，把这一行加到 .env（另需 GG_VERSION 与 GONGGONG_MACHINE_ID），然后运行 docker compose up -d --build，容器首次启动时自动绑定。',
            )}
          </p>
        </Disclosure>
      </FormRow>
    </Form>
  )
}
