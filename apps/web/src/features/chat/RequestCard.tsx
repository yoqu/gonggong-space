import type { MessageDto } from '@gonggong/protocol'
import { McpSecretCard } from '../config/McpSecretCard'
import { ConnectorCardView } from '../connectors/ConnectorCardView'
import { SecretCard } from '../secrets/SecretCard'

/** A message that asks someone for something before a bot goes on: a secret, an MCP server's keys, a connection. */
export const isRequestCard = (m: MessageDto) => !!(m.mcpSecret || m.secretCard || m.connectorCard)

export function RequestCard({ m }: { m: MessageDto }) {
  if (m.mcpSecret) return <McpSecretCard m={m} card={m.mcpSecret} />
  if (m.secretCard) return <SecretCard m={m} card={m.secretCard} />
  if (m.connectorCard) return <ConnectorCardView m={m} card={m.connectorCard} />
  return null
}
