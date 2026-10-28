export interface TerminalViewProps {
  sessionId?: string
  groupId?: string
  botId?: string
  /** A machine terminal: opens (or reattaches to) its space's shell instead of a bot's. */
  spaceId?: string
  active: boolean
  onSession?: (sessionId: string) => void
  onExit?: (exitCode: number | null, reason: string | null) => void
}
