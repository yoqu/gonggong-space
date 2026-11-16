import { AGENT_META, type AgentKind, type MachineDto, TERMINAL_DIR_FEATURE } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { Button, Dialog, Presence } from '../../ui'
import { NewTerminalDialog } from '../terminal/NewTerminalDialog'
import { CommandLine } from './AdminPanels'

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
    next: t('在打开的网页「模型」里填写 DeepSeek API Key（也可以在机器环境变量里设置 DEEPSEEK_API_KEY）'),
  },
  antigravity: {
    command: 'agy',
    next: t(
      '进入后按提示用 Google 账号登录；机器没有浏览器时改为运行 agy acp --login，在别处打开链接后粘贴授权码',
    ),
  },
  opencode: { command: 'opencode auth login', next: t('按提示选择供应商，在浏览器里登录或粘贴 API Key') },
  qwen: { command: 'qwen', next: t('进入后输入 /auth，选择 Qwen OAuth 在浏览器里登录，或填写 API Key') },
  kimi: { command: 'kimi', next: t('进入后输入 /login，按提示在浏览器里完成登录') },
  goose: { command: 'goose configure', next: t('选择 Configure Providers，按提示选择供应商并填写 API Key') },
  copilot: { command: 'copilot', next: t('进入后输入 /login，用 GitHub 账号完成设备登录') },
}

/**
 * The official login happens in the agent's own CLI on the machine: through a machine terminal from here. Without
 * `machine` it is the computer the desktop app runs on.
 */
export function AgentLoginDialog({
  machine,
  agent,
  onAddProvider,
  onClose,
}: {
  machine?: MachineDto
  agent: AgentKind
  onAddProvider: () => void
  onClose: () => void
}) {
  const [terminal, setTerminal] = useState(false)
  const terminals =
    !!machine?.online &&
    (machine.os === 'macos' || machine.os === 'linux') &&
    machine.features.includes(TERMINAL_DIR_FEATURE)
  const login = LOGIN[agent]
  return (
    <>
      <Dialog
        open={!terminal}
        title={t('登录 {agent} 官方账号', { agent: AGENT_META[agent].name })}
        message={
          machine
            ? t('官方账号在该机器上的 {agent} 里登录，登录信息只保存在该机器上。', {
                agent: AGENT_META[agent].name,
              })
            : t('官方账号在本机的 {agent} 里登录，登录信息只保存在本机。', { agent: AGENT_META[agent].name })
        }
        width={520}
        onClose={onClose}
        actions={[
          {
            label: t('改用 API Key 供应商'),
            onClick: () => {
              onClose()
              onAddProvider()
            },
          },
          { label: t('完成'), variant: 'primary', onClick: onClose },
        ]}
      >
        <ol className="mx-section mx-steps">
          <li>
            {terminals ? (
              <span className="mx-inline">
                {t('打开该机器的终端')}
                <Button size="small" icon="terminal" onClick={() => setTerminal(true)}>
                  {t('打开终端')}
                </Button>
              </span>
            ) : machine ? (
              t('在该机器上打开终端（Docker 里用 docker compose exec daemon bash）')
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
      </Dialog>
      <Presence>
        {terminal && machine ? <NewTerminalDialog machine={machine.id} onClose={onClose} /> : null}
      </Presence>
    </>
  )
}
