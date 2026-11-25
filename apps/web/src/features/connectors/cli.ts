import type { ConnectorDto, ConnectorMachineView } from '@gonggong/protocol'
import { t } from '../../i18n'

/** The machine whose login the connector shows: the first ready one, else where I would connect. */
export const cliMachine = (c: ConnectorDto): ConnectorMachineView | undefined =>
  c.cli?.machines.find((m) => m.state === 'ready') ??
  c.cli?.machines.find((m) => m.machineId === c.cli?.target)

const ERRORS: [RegExp, string][] = [
  [
    /node(\.js)?\b.*(not found|missing|ENOENT|未找到|找不到)|no node|缺少 ?node/i,
    t('这台电脑缺少 Node.js，自动安装也没成功，请稍后重试'),
  ],
  [
    /(mirror|registry|npm|镜像|download|下载).*(time ?out|timed out|ETIMEDOUT|超时)|(time ?out|timed out|ETIMEDOUT|超时).*(mirror|registry|npm|镜像)/i,
    t('下载命令行工具超时，请检查这台电脑的网络后重试'),
  ],
  [/keychain|钥匙串/i, t('这台电脑的 macOS 钥匙串已锁定，解锁后重试')],
  [
    /app.*(not (been )?enabled|disabled|not (been )?published)|应用未启用|应用未发布/i,
    t('飞书应用还没启用，请在飞书开放平台发布应用后重试'),
  ],
]

/** A daemon / CLI error as one plain Chinese reason; unknown ones read as they are. */
export function humanError(raw: string | null | undefined) {
  if (!raw) return t('连接失败')
  return ERRORS.find(([re]) => re.test(raw))?.[1] ?? raw
}

/** A draft's links whose host is one of `hosts` or under it (`x.feishu.cn` matches `feishu.cn`). */
export function linksTo(draft: string, hosts: string[]) {
  if (!hosts.length) return false
  for (const m of draft.matchAll(/https?:\/\/[^\s<>"'）)]+/g)) {
    let host: string
    try {
      host = new URL(m[0]).hostname
    } catch {
      continue
    }
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return true
  }
  return false
}
