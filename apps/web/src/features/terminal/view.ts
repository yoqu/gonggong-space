export interface TerminalViewProps {
  sessionId?: string
  groupId?: string
  botId?: string
  active: boolean
  onSession?: (sessionId: string) => void
  onExit?: (exitCode: number | null, reason: string | null) => void
}
