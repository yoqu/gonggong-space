import type { ConnectorCliView, ConnectorDto, ConnectorMachineView, WebEvent } from '@gonggong/protocol'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { cx } from '../../lib/cx'
import { realtime } from '../../lib/realtime'
import { Alert, Button, ConfirmActionDialog, Disclosure, Presence, Spinner, Tag, toast } from '../../ui'
import { humanError } from './cli'
import { cliAction, cliConnect, put } from './store'

type CliEvent = Extract<
  WebEvent,
  { t: 'connector.cli.progress' | 'connector.cli.auth' | 'connector.cli.result' }
>
type Auth = Extract<CliEvent, { t: 'connector.cli.auth' }>
type Stage = Extract<CliEvent, { t: 'connector.cli.progress' }>['stage']

interface Run {
  machineId: string | null
  stage: Stage | null
  lines: string[]
  auth: Auth | null
  /** Feishu's first time: 创建飞书应用 then 授权登录. */
  twoStep: boolean
}

const STAGE: Record<Stage, string> = {
  node: t('正在准备 Node.js 环境…'),
  install: t('正在安装命令行工具…'),
  init: t('正在创建飞书应用…'),
  login: t('正在发起授权…'),
}

const STATE: Record<ConnectorMachineView['state'], string> = {
  ready: t('已连接'),
  needs_login: t('未登录'),
  needs_init: t('未连接'),
  not_installed: t('未连接'),
  error: t('连接出错'),
}

const isCliEvent = (e: WebEvent): e is CliEvent =>
  e.t === 'connector.cli.progress' || e.t === 'connector.cli.auth' || e.t === 'connector.cli.result'

/**
 * A CLI connector in its dialog (plan 连接器-体验升级方案 §5.5): 连接 installs, binds an app and logs in on a machine by
 * itself, showing progress and the link to scan here, never in the chat; closing the dialog cancels it.
 */
export function CliConnect({
  groupId,
  c,
  cli,
  inGroup = true,
  domains = [],
  machineId: cardMachine,
  onTry,
  onRunningChange,
}: {
  groupId: string
  c: ConnectorDto
  cli: ConnectorCliView
  inGroup?: boolean
  /** Only these Feishu domains (a 就地连接 card asking for missing scopes). */
  domains?: string[]
  /** The machine a 就地连接 card asks to connect on (where the asking bot runs). */
  machineId?: string | null
  onTry?: (text: string) => void
  onRunningChange?: (running: boolean) => void
}) {
  const m = c.manifest
  const [run, setRun] = useState<Run | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [lastFailed, setLastFailed] = useState<{ kind: 'connect' | 'detect'; machineId?: string } | null>(
    null,
  )
  const [detectingId, setDetectingId] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState<{ machineId: string; machineName: string } | null>(null)
  useEffect(() => {
    onRunningChange?.(!!run)
  }, [run, onRunningChange])
  useEffect(() => () => onRunningChange?.(false), [onRunningChange])
  // The run's request: null while the POST is out (events meanwhile are buffered: they can beat its answer).
  const req = useRef<{ id: string | null; machineId: string | null; early: CliEvent[] } | null>(null)

  const apply = (e: CliEvent) => {
    if (e.t === 'connector.cli.result') {
      const failedMachineId = req.current?.machineId ?? undefined
      req.current = null
      setRun(null)
      put(groupId, e.connector)
      if (e.ok) {
        setLastFailed(null)
        toast({ type: 'success', message: t('已连接「{name}」', { name: m.title }) })
      } else {
        setLastFailed({ kind: 'connect', machineId: failedMachineId })
        setFailure(humanError(e.error ?? e.probe?.detail))
      }
      return
    }
    setRun((r) =>
      !r
        ? r
        : e.t === 'connector.cli.auth'
          ? { ...r, auth: e, stage: e.step, twoStep: r.twoStep || e.step === 'init' }
          : {
              ...r,
              stage: e.stage,
              lines: [...r.lines, e.line].slice(-200),
              twoStep: r.twoStep || e.stage === 'init',
            },
    )
  }
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => {
    const off = realtime.subscribe((e) => {
      const r = req.current
      if (!r || !isCliEvent(e)) return
      if (r.id === null) r.early.push(e)
      else if (e.requestId === r.id) applyRef.current(e)
    })
    return () => {
      off()
      // Closing mid-way stops the login waiting on the machine.
      if (req.current)
        void cliAction(groupId, c.id, 'cancel', req.current.machineId ?? undefined).catch(() => {})
    }
  }, [groupId, c.id])

  const connect = async (picked?: string) => {
    const machineId = picked ?? cardMachine ?? undefined
    setFailure(null)
    setLastFailed(null)
    const first =
      m.connector?.cli?.driver === 'lark-cli' &&
      ['needs_init', 'not_installed'].includes(
        (machineId ? cli.machines.find((x) => x.machineId === machineId)?.state : cli.state) ?? '',
      )
    req.current = { id: null, machineId: machineId ?? null, early: [] }
    setRun({ machineId: machineId ?? null, stage: null, lines: [], auth: null, twoStep: first })
    try {
      const started = await cliConnect(groupId, c.id, { machineId, domains })
      const r = req.current
      if (!r) return
      r.id = started.requestId
      r.machineId = started.machineId
      setRun((x) => x && { ...x, machineId: started.machineId })
      for (const e of r.early.splice(0)) if (e.requestId === started.requestId) apply(e)
    } catch (e) {
      req.current = null
      setRun(null)
      setLastFailed({ kind: 'connect', machineId })
      setFailure(humanError(errorText(e)))
    }
  }
  const cancel = () => {
    const r = req.current
    req.current = null
    setRun(null)
    void cliAction(groupId, c.id, 'cancel', r?.machineId ?? undefined).catch(() => {})
  }
  const detect = async (machineId?: string) => {
    const id = machineId ?? mine?.machineId
    setDetectingId(id ?? '')
    setFailure(null)
    setLastFailed(null)
    try {
      await cliAction(groupId, c.id, 'detect', id)
    } catch (e) {
      setLastFailed({ kind: 'detect', machineId: id })
      setFailure(errorText(e))
    } finally {
      setDetectingId(null)
    }
  }

  // Only the owner connects, checks or signs out on a machine; everyone else just uses what is there.
  const target = cli.machines.find((x) => x.machineId === (cardMachine ?? cli.target) && x.own)
  const mine = cli.machines.find((x) => x.own && x.state === 'ready')
  const example = m.connector?.examples[0]
  const bots = useWorkspace((s) => s.bots)
  const groupBotIds = useWorkspace((s) => s.groups.find((g) => g.id === groupId)?.botIds) ?? []
  const names = (ids: string[]) => ids.map((id) => bots.find((b) => b.id === id)?.name ?? id).join(t('、'))
  const unreadyBotIds = cli.state === 'ready' ? groupBotIds.filter((id) => !cli.readyBotIds.includes(id)) : []
  const retryFailed = () => {
    if (lastFailed?.kind === 'detect') void detect(lastFailed.machineId)
    else void connect(lastFailed?.machineId)
  }
  return (
    <div className="cn-cli">
      {failure ? (
        <Alert variant="error" title={failure} onRetry={retryFailed} retryLabel={t('重试')} />
      ) : null}
      {run ? (
        <CliProgress run={run} onCancel={cancel} />
      ) : cli.state === 'no_machine' ? (
        <Alert variant="info" title={t('Bot 所在电脑不在线')} />
      ) : cli.state === 'ready' && !domains.length && (!target || target.state === 'ready') ? (
        <div className="cn-detail__actions">
          {example && onTry ? (
            <Button size="large" variant="primary" icon="bubble" onClick={() => onTry(example)}>
              {t('去试试')}
            </Button>
          ) : null}
          {mine ? (
            <>
              <Button
                size="large"
                loading={detectingId === mine.machineId}
                disabled={detectingId !== null}
                onClick={() => void detect(mine.machineId)}
              >
                {t('重新检测')}
              </Button>
              <Button
                size="large"
                variant="plain"
                onClick={() => setLoggingOut({ machineId: mine.machineId, machineName: mine.machineName })}
              >
                {t('退出登录')}
              </Button>
            </>
          ) : null}
        </div>
      ) : !target ? (
        <Alert variant="info" title={t('请 Bot 所在电脑的主人连接')} />
      ) : (
        <>
          {domains.length ? (
            <div className="gs-note">{t('需要补充权限：{domains}', { domains: domains.join(t('、')) })}</div>
          ) : null}
          <div className="cn-detail__actions">
            <Button size="large" variant="primary" onClick={() => void connect(target.machineId)}>
              {domains.length && target.state === 'ready'
                ? t('补充授权')
                : cli.state === 'error'
                  ? t('重试')
                  : c.status === 'expired'
                    ? t('重新连接')
                    : t('连接')}
            </Button>
          </div>
          <div className="gs-note">
            {inGroup
              ? t(
                  '在 {machine} 上用你的账号登录，自动安装所需工具；群里任何人 @ 这台电脑上的 Bot 都会用这个账号。',
                  { machine: target.machineName },
                )
              : t('在 {machine} 上用你的账号登录，自动安装所需工具。', { machine: target.machineName })}
          </div>
        </>
      )}
      {!run && unreadyBotIds.length ? (
        <div className="gs-note">
          {t('{bots} 所在电脑尚未连接{name}，需其电脑主人连接后可用', {
            bots: names(unreadyBotIds),
            name: m.title,
          })}
        </div>
      ) : null}
      {cli.machines.length ? (
        <Disclosure title={t('电脑 · {n}', { n: cli.machines.length })}>
          <ul className="cn-machines" aria-label={t('各电脑的连接状态')}>
            {cli.machines.map((x) => (
              <li key={x.machineId} className="cn-machines__row">
                <span className="cn-machines__name">
                  {x.machineName}
                  {x.own ? <Tag tone="blue">{t('我的')}</Tag> : null}
                  {x.botIds.length ? (
                    <span className="cn-machines__bots">
                      {t('可用的 Bot：{bots}', { bots: names(x.botIds) })}
                    </span>
                  ) : null}
                </span>
                <span className={cx('cn-machines__state', x.state === 'ready' && 'cn-machines__state--ok')}>
                  {x.state === 'ready' && x.account
                    ? t('已连接 · {account}', { account: x.account })
                    : STATE[x.state]}
                </span>
                {!x.own ? null : x.state === 'ready' ? (
                  <>
                    <Button
                      size="small"
                      variant="plain"
                      loading={detectingId === x.machineId}
                      disabled={!!run || detectingId !== null}
                      aria-label={t('重新检测 {machine}', { machine: x.machineName })}
                      onClick={() => void detect(x.machineId)}
                    >
                      {t('重新检测')}
                    </Button>
                    <Button
                      size="small"
                      variant="plain"
                      disabled={!!run}
                      aria-label={t('退出 {machine} 登录', { machine: x.machineName })}
                      onClick={() => setLoggingOut({ machineId: x.machineId, machineName: x.machineName })}
                    >
                      {t('退出登录')}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    disabled={!!run}
                    aria-label={t('在 {machine} 上连接', { machine: x.machineName })}
                    onClick={() => void connect(x.machineId)}
                  >
                    {t('连接')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      <Presence>
        {loggingOut ? (
          <ConfirmActionDialog
            title={t('退出 {machine} 上的「{name}」登录？', {
              machine: loggingOut.machineName,
              name: m.title,
            })}
            message={t('{machine} 上的 Bot 将不能再用你的账号访问「{name}」，之后可以随时重新连接。', {
              machine: loggingOut.machineName,
              name: m.title,
            })}
            consequences={[]}
            label={t('退出登录')}
            done={t('已退出「{name}」', { name: m.title })}
            run={() => cliAction(groupId, c.id, 'logout', loggingOut.machineId)}
            onClose={() => setLoggingOut(null)}
          />
        ) : null}
      </Presence>
    </div>
  )
}

function CliProgress({ run, onCancel }: { run: Run; onCancel: () => void }) {
  const { auth } = run
  const step = run.stage === 'login' ? 2 : 1
  return (
    <section className="cn-run" aria-label={t('连接进度')}>
      {run.twoStep ? (
        <ol className="cn-steps">
          <li className={cx(step === 1 && 'is-current', step > 1 && 'is-done')}>{t('创建飞书应用')}</li>
          <li className={cx(step === 2 && 'is-current')}>{t('授权登录')}</li>
        </ol>
      ) : null}
      {auth ? (
        <div className="cn-auth">
          <QRCodeSVG value={auth.url} size={180} marginSize={2} title={t('授权二维码')} />
          <span className="gs-note">
            {auth.step === 'init'
              ? t('用飞书扫码，创建你自己的飞书应用')
              : t('用手机扫码或在浏览器中打开，同意授权')}
          </span>
          {auth.userCode ? (
            <span className="cn-auth__code">
              {t('验证码')} <code>{auth.userCode}</code>
              <Button
                size="small"
                variant="plain"
                icon="copy"
                aria-label={t('复制验证码')}
                onClick={() => auth.userCode && void copyWithToast(auth.userCode, t('已复制验证码'))}
              >
                {t('复制')}
              </Button>
            </span>
          ) : null}
          <Button variant="primary" onClick={() => window.open(auth.url, '_blank', 'noopener,noreferrer')}>
            {t('在浏览器中打开')}
          </Button>
        </div>
      ) : (
        <div className="cn-run__stage">
          <Spinner />
          <span>{run.stage ? STAGE[run.stage] : t('正在连接…')}</span>
        </div>
      )}
      {run.lines.length ? (
        <Disclosure title={t('查看日志')}>
          <pre className="cn-run__log">{run.lines.join('\n')}</pre>
        </Disclosure>
      ) : null}
      <div className="cn-detail__actions">
        <Button onClick={onCancel}>{t('取消')}</Button>
      </div>
    </section>
  )
}
