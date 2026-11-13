import type { BindCodeDto } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from '../../lib/api'
import { copyText, copyWithToast } from '../../lib/clipboard'
import { Alert, Button, Disclosure, Form, FormRow, Icon, IconButton, Spinner, toast } from '../../ui'
import './machines.css'
import { t } from '../../i18n'

export interface BindCode {
  code: BindCodeDto | null
  error: string
  generate: () => Promise<void>
}

/**
 * A one-time 接入链接, generated whenever `open` turns on. An expired code is swapped for a new one in place (until
 * `done`): a machine that used the old one asks to be confirmed on the web instead of failing.
 */
export function useBindCode(open: boolean, done = false): BindCode {
  const [code, setCode] = useState<BindCodeDto | null>(null)
  const [error, setError] = useState('')

  const generate = useCallback(async () => {
    setError('')
    try {
      setCode(await api.post<BindCodeDto>('/bind-codes'))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    setCode(null)
    if (open) void generate()
  }, [open, generate])

  useEffect(() => {
    if (!open || done || !code) return
    const timer = setTimeout(() => void generate(), Math.max(0, Date.parse(code.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [open, done, code, generate])

  return { code, error, generate }
}

export const loginCommand = (code: BindCodeDto) => `gg login --server ${location.origin} --code ${code.code}`

export const dockerEnv = (code: BindCodeDto) => `GONGGONG_BIND_URL='${code.link}'`

const copy = (text: string, message: string) => void copyWithToast(text, message)

/**
 * 发给你的 Agent (Agent 自助接入): the sentence to paste to a local Claude Code / Codex, which installs gg, binds this
 * machine and gets its bot made by itself.
 */
export function AgentPrompt({ bind, onCopied }: { bind: BindCode; onCopied?: (code: string) => void }) {
  const { code, error, generate } = bind
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
  return (
    <div className="bind__prompt-card">
      <p className="bind__prompt">{code.agentPrompt}</p>
      <span className="bind__code-line">
        <Button
          variant="primary"
          onClick={() =>
            void copyText(code.agentPrompt).then(
              () => {
                setCopied(code.code)
                onCopied?.(code.code)
              },
              () => toast({ type: 'error', message: t('复制失败') }),
            )
          }
        >
          {copied === code.code ? t('已复制') : t('复制')}
        </Button>
        <span className="bind__note">{t('接入码过期也能接入，届时在这里点一下允许')}</span>
      </span>
    </div>
  )
}

/** 接入链接: open it in the desktop app, or copy it; the gg login command sits under 使用命令行. */
export function BindCodePanel({ bind }: { bind: BindCode }) {
  const { code, error, generate } = bind
  return (
    <Form>
      <FormRow label={t('接入链接')} align="top">
        {code ? (
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
              disabled={!code}
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
              disabled={!code}
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
          <p className="bind__note">{t('接入码 30 分钟内有效，过期请重新生成。')}</p>
        </Disclosure>
      </FormRow>
    </Form>
  )
}
