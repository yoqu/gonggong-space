import type { TerminalCreateReq, TerminalDto, TerminalLinkDto } from '@gonggong/protocol'
import { api } from '../../lib/api'

export function createTerminal(groupId: string, botId: string, size: TerminalCreateReq) {
  return api.post<TerminalDto>(`/groups/${groupId}/bots/${botId}/terminals`, size)
}

export function listTerminals(groupId: string, botId: string) {
  return api.get<TerminalDto[]>(`/groups/${groupId}/bots/${botId}/terminals`)
}

export function endTerminal(sessionId: string) {
  return api.del<void>(`/terminals/${sessionId}`)
}

export function terminalSocketUrl(sessionId: string, after = 0) {
  const url = new URL(`/ws/terminals/${sessionId}`, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('after', String(after))
  return url.toString()
}

export function resolveTerminalLink(groupId: string, botId: string, path: string, line = 1) {
  return api.post<TerminalLinkDto>(`/groups/${groupId}/bots/${botId}/terminal-links/resolve`, { path, line })
}
