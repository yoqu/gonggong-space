import type { TerminalOpen } from '@gonggong/protocol'

export interface TerminalAttachment {
  /** Detaches one browser connection without ending the daemon's PTY. */
  detach(): void
}

export interface TerminalTransport {
  attach(open: TerminalOpen): Promise<TerminalAttachment>
  /** Resolves only after the daemon confirms that the PTY has terminated. */
  terminate(sessionId: string, reason: 'user' | 'revoked'): Promise<void>
}
