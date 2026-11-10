import { type AgentKind, type MachineDto, TERMINAL_DIR_FEATURE } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { Button, Dialog, Presence } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { NewTerminalDialog } from '../terminal/NewTerminalDialog'
import { CommandLine } from './AdminPanels'

const LOGIN: Record<AgentKind, { command: string; next: string }> = {
  claude: { command: 'claude', next: t('进入后输入 /login，按提示在浏览器里完成登录') },
  codex: { command: 'codex login --device-auth', next: t('打开它给出的链接，输入验证码完成登录') },
  gemini: {
    command: 'gemini',
    next: t('进入后输入 /auth，选择 Gemini API Key 并粘贴 Key（个人 Google 账号登录已不再支持）'),
  },
}

/** The official login happens in the agent's own CLI on the machine: through a machine terminal from here. */
export function AgentLoginDialog({
  machine,
  agent,
  onAddProvider,
  onClose,
}: {
  machine: MachineDto
  agent: AgentKind
  onAddProvider: () => void
  onClose: () => void
}) {
  const [terminal, setTerminal] = useState(false)
  const terminals =
    machine.online &&
    (machine.os === 'macos' || machine.os === 'linux') &&
    machine.features.includes(TERMINAL_DIR_FEATURE)
  const login = LOGIN[agent]
  return (
    <>
      <Dialog
        open={!terminal}
        title={t('登录 {agent} 官方账号', { agent: AGENT_LABEL[agent] })}
        message={t('官方账号在该机器上的 {agent} 里登录，登录信息只保存在该机器上。', {
          agent: AGENT_LABEL[agent],
        })}
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
            ) : (
              t('在该机器上打开终端（Docker 里用 docker compose exec daemon bash）')
            )}
          </li>
          <li className="mx-section">
            {t('运行')}
            <CommandLine command={login.command} />
          </li>
          <li>{login.next}</li>
        </ol>
      </Dialog>
      <Presence>{terminal ? <NewTerminalDialog machine={machine.id} onClose={onClose} /> : null}</Presence>
    </>
  )
}
