import {
  AGENT_META,
  type AgentAuthMethod,
  type AgentKind,
  type AgentState,
  type MachineDto,
  TERMINAL_DIR_FEATURE,
} from '@gonggong/protocol'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { Button, Dialog, Disclosure, Icon, type ModalAction, Presence, Spinner, toast } from '../../ui'
import type { AgentLoginDriver, AgentLoginEvent } from '../agents/source'
import { NewTerminalDialog } from '../terminal/NewTerminalDialog'
import { CommandLine } from './AdminPanels'
import './agent-login.css'

const LOGIN: Record<AgentKind, { command: string; next: string }> = {
  claude: { command: 'claude', next: t('进入后输入 /login，按提示在浏览器里完成登录') },
  codex: { command: 'codex login --device-auth', next: t('打开它给出的链接，输入验证码完成登录') },
  gemini: {
    command: 'gemini',
    next: t('进入后输入 /auth，选择 Gemini API Key 并粘贴 Key（个人 Google 账号登录已不再支持）'),
  },
  codebuddy: { command: 'codebuddy', next: t('进入后输入 /login，用微信、Google/GitHub 或企业账号登录') },
  pi: { command: 'pi', next: t('进入后输入 /login，选择供应商登录或填写 API Key') },
  deepseek: {
    command: 'dsh web',
    next: t('在打开的网页「模型」里填写 DeepSeek API Key（也可以在电脑环境变量里设置 DEEPSEEK_API_KEY）'),
  },
  antigravity: {
    command: 'agy',
    next: t(
      '进入后按提示用 Google 账号登录；电脑没有浏览器时改为运行 agy acp --login，在别处打开链接后粘贴授权码',
    ),
  },
  opencode: { command: 'opencode auth login', next: t('按提示选择供应商，在浏览器里登录或粘贴 API Key') },
  qwen: { command: 'qwen', next: t('进入后输入 /auth，选择 Qwen OAuth 在浏览器里登录，或填写 API Key') },
  kimi: { command: 'kimi', next: t('进入后输入 /login，按提示在浏览器里完成登录') },
  goose: { command: 'goose configure', next: t('选择 Configure Providers，按提示选择供应商并填写 API Key') },
  copilot: { command: 'copilot login', next: t('打开它给出的链接，输入验证码完成登录') },
}

interface MethodChoice {
  id: string
  label: string
  description?: string
}

const CODEBUDDY_METHOD_LABELS: Record<string, { label: string; description: string }> = {
  internal: { label: t('微信登录（国内版）'), description: t('中国站 codebuddy.cn，微信扫码登录') },
  external: { label: t('Google / GitHub（国际版）'), description: t('国际站 codebuddy.ai') },
  iOA: { label: 'iOA', description: t('腾讯内部账号') },
  selfhosted: { label: t('企业私有域名'), description: t('企业私有部署环境') },
}

function defaultMethods(agent: AgentKind): MethodChoice[] {
  if (agent === 'codebuddy') {
    return Object.entries(CODEBUDDY_METHOD_LABELS).map(([id, m]) => ({
      id,
      label: m.label,
      description: m.description,
    }))
  }
  return []
}

function mapMethods(agent: AgentKind, methods: AgentAuthMethod[]): MethodChoice[] {
  return methods.map((m) => {
    const known = agent === 'codebuddy' ? CODEBUDDY_METHOD_LABELS[m.id] : undefined
    return {
      id: m.id,
      label: known?.label ?? m.name,
      description: known?.description ?? m.description ?? undefined,
    }
  })
}

type AcpPhase = 'idle' | 'starting' | 'authorizing' | 'success' | 'error'

const STAGE_LABEL: Record<string, string> = {
  starting: t('正在启动授权…'),
  authenticating: t('正在获取授权链接…'),
  awaiting_auth: t('请在浏览器或微信中完成登录…'),
}

/**
 * Official account login dialog, shared by Web and Desktop:
 * - Flow A: Native ACP one-click OAuth (QR + browser link) when supported.
 * - Flow B: Desktop local terminal launcher (pre-loaded with managed Node/tools PATH) + refresh.
 * - Flow C: Web guidance with Desktop deep link, remote terminal (macOS/Linux), or API Key provider.
 */
export function AgentLoginDialog({
  machine,
  agent,
  agentState,
  loginDriver,
  onAddProvider,
  onLoggedIn,
  onClose,
}: {
  machine?: MachineDto
  agent: AgentKind
  agentState?: AgentState
  loginDriver?: AgentLoginDriver
  onAddProvider?: () => void
  onLoggedIn?: () => void
  onClose: () => void
}) {
  const agentName = AGENT_META[agent].name
  const isDesktop = loginDriver?.mode === 'desktop' || !machine
  const supportsAcp =
    agentState?.loginFlow === 'acp' &&
    !!loginDriver?.supportsAcp &&
    !!loginDriver.startAcp &&
    (isDesktop || !!machine?.features.includes('agent_login'))

  const [manualFallback, setManualFallback] = useState(false)
  const useAcp = supportsAcp && !manualFallback

  // Flow A (ACP OAuth) state
  const [methods, setMethods] = useState<MethodChoice[]>(() => defaultMethods(agent))
  const [methodId, setMethodId] = useState<string>(() => defaultMethods(agent)[0]?.id ?? '')
  const [phase, setPhase] = useState<AcpPhase>('idle')
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [stageText, setStageText] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [loggedInUser, setLoggedInUser] = useState<string | null>(null)

  // Flow B / C state
  const [terminal, setTerminal] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const opRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const autoOpenedOpRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  const openUrl = useCallback(
    (url: string) => {
      if (loginDriver?.openExternalUrl) {
        void Promise.resolve(loginDriver.openExternalUrl(url)).catch((e: unknown) =>
          toast({ type: 'error', message: errorText(e) }),
        )
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    },
    [loginDriver],
  )

  const cleanupAcp = useCallback(
    (cancelActive: boolean) => {
      const activeOp = opRef.current
      opRef.current = null
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
      if (cancelActive && activeOp && loginDriver?.cancelAcp) {
        void loginDriver.cancelAcp(agent, activeOp).catch(() => {})
      }
    },
    [agent, loginDriver],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanupAcp(true)
    }
  }, [cleanupAcp])

  // Auto-refresh on window focus while doing manual / terminal login so status updates right away.
  useEffect(() => {
    if (useAcp && phase !== 'authorizing') return
    const onFocus = () => {
      if (!useAcp) {
        void loginDriver?.refresh?.().catch(() => {})
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [useAcp, phase, loginDriver])

  const handleClose = useCallback(() => {
    cleanupAcp(phase === 'starting' || phase === 'authorizing')
    onClose()
  }, [cleanupAcp, phase, onClose])

  const startAcpLogin = useCallback(async () => {
    if (!loginDriver?.startAcp) return
    cleanupAcp(true)
    setPhase('starting')
    setAuthUrl(null)
    setErrorMsg('')
    setLoggedInUser(null)
    setLines([])
    setStageText(t('正在启动授权…'))

    const pendingEvents: AgentLoginEvent[] = []
    let readyOpId: string | null = null

    const handleEvent = (ev: AgentLoginEvent) => {
      if (!mountedRef.current) return
      if (ev.kind !== agent) return
      if (readyOpId && ev.opId !== readyOpId) return
      if (ev.t === 'agent.login.methods') {
        const mapped = mapMethods(agent, ev.methods)
        if (mapped.length) {
          setMethods(mapped)
          setMethodId((cur) => (mapped.some((m) => m.id === cur) ? cur : (mapped[0]?.id ?? cur)))
        }
      } else if (ev.t === 'agent.login.auth') {
        setAuthUrl(ev.url)
        setPhase('authorizing')
        setStageText(t('请在浏览器或微信中完成登录…'))
        // On Desktop, open once via system opener (we pass openBrowser: false to avoid double-open).
        if (loginDriver.mode === 'desktop' && autoOpenedOpRef.current !== ev.opId) {
          autoOpenedOpRef.current = ev.opId
          openUrl(ev.url)
        }
      } else if (ev.t === 'agent.login.progress') {
        if (ev.stage) setStageText(STAGE_LABEL[ev.stage] ?? ev.stage)
        const line = ev.line
        if (line) setLines((prev) => [...prev, line])
      } else if (ev.t === 'agent.login.result') {
        cleanupAcp(false)
        if (ev.ok) {
          setPhase('success')
          setLoggedInUser(ev.user ?? null)
          void Promise.resolve(loginDriver.refresh?.()).catch(() => {})
          onLoggedIn?.()
        } else {
          setPhase('error')
          setErrorMsg(ev.error || t('登录未完成，请重试'))
        }
      }
    }

    try {
      if (loginDriver.subscribeAcp) {
        const unsub = await loginDriver.subscribeAcp((ev) => {
          if (!readyOpId) pendingEvents.push(ev)
          else handleEvent(ev)
        })
        if (!mountedRef.current) {
          unsub()
          return
        }
        unsubRef.current = unsub
      }

      const { opId } = await loginDriver.startAcp({
        kind: agent,
        methodId: methodId || undefined,
        openBrowser: false,
      })
      if (!mountedRef.current) {
        void loginDriver.cancelAcp?.(agent, opId).catch(() => {})
        return
      }
      readyOpId = opId
      opRef.current = opId
      for (const ev of pendingEvents) handleEvent(ev)
    } catch (e) {
      cleanupAcp(false)
      if (!mountedRef.current) return
      setPhase('error')
      setErrorMsg(errorText(e))
    }
  }, [agent, cleanupAcp, loginDriver, methodId, onLoggedIn, openUrl])

  const cancelAcpLogin = useCallback(() => {
    cleanupAcp(true)
    setPhase('idle')
    setAuthUrl(null)
    setStageText('')
  }, [cleanupAcp])

  const handleLaunchDesktopTerminal = async () => {
    if (!loginDriver?.launchTerminal) return
    setLaunching(true)
    try {
      await loginDriver.launchTerminal(agent)
      toast({ type: 'success', message: t('已打开终端，请按提示完成登录') })
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setLaunching(false)
    }
  }

  const handleManualRefresh = async () => {
    setRefreshing(true)
    try {
      await loginDriver?.refresh?.()
      onLoggedIn?.()
      toast({ type: 'success', message: t('已刷新登录状态') })
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setRefreshing(false)
    }
  }

  const switchToProvider = () => {
    handleClose()
    onAddProvider?.()
  }

  const terminals =
    !!machine?.online &&
    (machine.os === 'macos' || machine.os === 'linux') &&
    machine.features.includes(TERMINAL_DIR_FEATURE)
  const isWindowsWebFallback = !isDesktop && machine?.os === 'windows' && !supportsAcp
  const desktopDeepLink = `gonggong://agents?kind=${encodeURIComponent(agent)}&action=login`
  const login = LOGIN[agent]

  // Compute dialog footer actions per flow & state (single primary CTA per state).
  const actions: ModalAction[] = (() => {
    if (useAcp) {
      if (phase === 'idle') {
        const list: ModalAction[] = []
        if (onAddProvider) {
          list.push({ label: t('改用 API Key 供应商'), onClick: switchToProvider })
        }
        list.push({ label: t('取消'), onClick: handleClose })
        list.push({
          label: t('开始登录授权'),
          variant: 'primary',
          autoFocus: true,
          onClick: () => void startAcpLogin(),
        })
        return list
      }
      if (phase === 'starting' || phase === 'authorizing') {
        return [{ label: t('取消'), onClick: cancelAcpLogin }]
      }
      if (phase === 'success') {
        return [{ label: t('完成'), variant: 'primary', autoFocus: true, onClick: handleClose }]
      }
      // error
      const list: ModalAction[] = []
      if (onAddProvider) {
        list.push({ label: t('改用 API Key 供应商'), onClick: switchToProvider })
      }
      list.push({ label: t('重试'), variant: 'primary', onClick: () => void startAcpLogin() })
      return list
    }

    const list: ModalAction[] = []
    if (onAddProvider) {
      list.push({ label: t('改用 API Key 供应商'), onClick: switchToProvider })
    }
    if (isDesktop && (loginDriver?.refresh || onLoggedIn)) {
      list.push({
        label: t('已完成登录，刷新状态'),
        loading: refreshing,
        disabled: refreshing,
        onClick: () => void handleManualRefresh(),
      })
    }
    list.push({ label: t('完成'), variant: 'primary', onClick: handleClose })
    return list
  })()

  return (
    <>
      <Dialog
        open={!terminal}
        title={t('登录 {agent} 官方账号', { agent: agentName })}
        message={
          machine
            ? t('官方账号在这台电脑上的 {agent} 里登录，登录信息只保存在这台电脑上。', {
                agent: agentName,
              })
            : t('官方账号在本机的 {agent} 里登录，登录信息只保存在本机。', { agent: agentName })
        }
        width={520}
        onClose={handleClose}
        actions={actions}
      >
        {useAcp ? (
          <div className="ag-login">
            {phase === 'idle' ? (
              <>
                {methods.length ? (
                  <fieldset className="ag-login__methods">
                    <legend className="ag-login__legend">{t('选择登录方式')}</legend>
                    {methods.map((m) => (
                      <label key={m.id} className="ag-login__method">
                        <input
                          type="radio"
                          name={`agent-login-method-${agent}`}
                          className="ag-login__radio"
                          value={m.id}
                          checked={methodId === m.id}
                          onChange={() => setMethodId(m.id)}
                        />
                        <span className="ag-login__method-body">
                          <span className="ag-login__method-name">{m.label}</span>
                          {m.description ? (
                            <span className="ag-login__method-desc">{m.description}</span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                {isDesktop && loginDriver?.launchTerminal ? (
                  <div className="ag-login__alt-links">
                    <button type="button" className="mx-link" onClick={() => setManualFallback(true)}>
                      {t('在终端中手动登录')}
                    </button>
                  </div>
                ) : null}
              </>
            ) : phase === 'starting' ? (
              <div className="ag-login__status">
                <Spinner />
                <span>{stageText || t('正在启动授权…')}</span>
              </div>
            ) : phase === 'authorizing' && authUrl ? (
              <div className="ag-login__auth">
                <div className="ag-login__qr">
                  <QRCodeSVG value={authUrl} size={180} marginSize={2} title={t('授权二维码')} />
                </div>
                <span className="ag-login__auth-hint">
                  <Spinner />
                  <span>{t('请在浏览器或微信中完成登录…')}</span>
                </span>
                <Button variant="primary" icon="external" onClick={() => openUrl(authUrl)}>
                  {t('在浏览器中打开')}
                </Button>
                <div className="ag-login__url-row">
                  <span className="ag-login__url" title={authUrl}>
                    {authUrl}
                  </span>
                  <Button
                    size="small"
                    variant="plain"
                    icon="copy"
                    onClick={() => void copyWithToast(authUrl, t('已复制链接'))}
                  >
                    {t('复制链接')}
                  </Button>
                </div>
              </div>
            ) : phase === 'success' ? (
              <div className="ag-login__result" role="status">
                <Icon name="checkmark-circle" size={28} />
                <span className="ag-login__result-title">{t('登录成功')}</span>
                {loggedInUser ? (
                  <span className="ag-login__result-sub">
                    {t('已登录账号：{user}', { user: loggedInUser })}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="ag-login__error" role="alert">
                <span className="ag-login__error-head">
                  <Icon name="exclamation-circle" size={16} />
                  <span>{t('登录失败')}</span>
                </span>
                <span className="ag-login__error-body">{errorMsg}</span>
                <div className="ag-login__alt-links">
                  {onAddProvider ? (
                    <button type="button" className="mx-link" onClick={switchToProvider}>
                      {t('改为配置 API Key')}
                    </button>
                  ) : null}
                  {isDesktop && loginDriver?.launchTerminal ? (
                    <button type="button" className="mx-link" onClick={() => setManualFallback(true)}>
                      {t('在终端中手动登录')}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
            {lines.length ? (
              <Disclosure title={t('查看日志')}>
                <pre className="ag-login__log">{lines.join('\n')}</pre>
              </Disclosure>
            ) : null}
          </div>
        ) : (
          <div className="ag-login">
            {isDesktop && loginDriver?.launchTerminal ? (
              <div className="ag-login__callout">
                <span className="ag-login__callout-text">
                  <span className="mx-strong">{t('一键打开终端登录')}</span>
                  <span className="mx-sub">{t('自动加载共工托管的 Node.js 与 Agent 路径')}</span>
                </span>
                <Button
                  variant="primary"
                  icon="terminal"
                  loading={launching}
                  disabled={launching}
                  onClick={() => void handleLaunchDesktopTerminal()}
                >
                  {t('打开终端登录')}
                </Button>
              </div>
            ) : isWindowsWebFallback ? (
              <div className="ag-login__callout">
                <span className="ag-login__callout-text">
                  <span className="mx-strong">{t('在桌面端一键登录')}</span>
                  <span className="mx-sub">
                    {t('升级这台 Windows 电脑上的共工客户端后，也支持直接在网页端扫码登录')}
                  </span>
                </span>
                <a href={desktopDeepLink} className="ui-btn ui-btn--primary ui-btn--regular bind__open-link">
                  {t('在共工桌面端打开登录')}
                </a>
              </div>
            ) : null}
            <ol className="mx-section mx-steps">
              <li>
                {terminals ? (
                  <span className="mx-inline">
                    {t('打开这台电脑的终端')}
                    <Button size="small" icon="terminal" onClick={() => setTerminal(true)}>
                      {t('打开终端')}
                    </Button>
                  </span>
                ) : machine ? (
                  t('在这台电脑上打开终端（Docker 里用 docker compose exec daemon bash）')
                ) : (
                  t('在本机打开终端')
                )}
              </li>
              <li className="mx-section">
                {t('运行')}
                <CommandLine command={login.command} />
              </li>
              <li>{login.next}</li>
            </ol>
            {isWindowsWebFallback ? (
              <p className="ag-login__note">
                {t(
                  '提示：如果通过共工空间托管安装了 {agent}，工具位于 %USERPROFILE%\\.gonggong\\tools，手动运行需先确保 Node.js 在 PATH 中，或直接点上方按钮在桌面端打开。',
                  { agent: agentName },
                )}
              </p>
            ) : null}
          </div>
        )}
      </Dialog>
      <Presence>
        {terminal && machine ? <NewTerminalDialog machine={machine.id} onClose={onClose} /> : null}
      </Presence>
    </>
  )
}
